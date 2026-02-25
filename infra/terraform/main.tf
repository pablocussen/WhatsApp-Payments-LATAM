# ═══════════════════════════════════════════════════════════
#  WhatPay - Google Cloud Platform Infrastructure
#  Region: southamerica-west1 (Santiago, Chile)
# ═══════════════════════════════════════════════════════════

terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }

  backend "gcs" {
    bucket = "whatpay-terraform-state"
    prefix = "terraform/state"
  }
}

# ─── Variables ───────────────────────────────────────────

variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = "southamerica-west1"
}

variable "environment" {
  description = "Environment (dev, staging, prod)"
  type        = string
  default     = "dev"
}

# ─── Provider ────────────────────────────────────────────

provider "google" {
  project = var.project_id
  region  = var.region
}

# ─── Enable APIs ─────────────────────────────────────────

resource "google_project_service" "apis" {
  for_each = toset([
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "redis.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudkms.googleapis.com",
    "pubsub.googleapis.com",
    "aiplatform.googleapis.com",
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "monitoring.googleapis.com",
    "logging.googleapis.com",
  ])

  service            = each.key
  disable_on_destroy = false
}

# ─── VPC Network ─────────────────────────────────────────

resource "google_compute_network" "vpc" {
  name                    = "whatpay-vpc-${var.environment}"
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "subnet" {
  name          = "whatpay-subnet-${var.environment}"
  ip_cidr_range = "10.0.0.0/24"
  network       = google_compute_network.vpc.id
  region        = var.region
}

# ─── Cloud SQL (PostgreSQL) ──────────────────────────────

resource "google_sql_database_instance" "postgres" {
  name             = "whatpay-db-${var.environment}"
  database_version = "POSTGRES_16"
  region           = var.region

  settings {
    tier              = var.environment == "prod" ? "db-custom-2-8192" : "db-f1-micro"
    availability_type = var.environment == "prod" ? "REGIONAL" : "ZONAL"

    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.vpc.id
    }

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = var.environment == "prod"
      start_time                     = "03:00"
    }

    database_flags {
      name  = "max_connections"
      value = "100"
    }
  }

  deletion_protection = var.environment == "prod"
}

resource "google_sql_database" "whatpay_db" {
  name     = "whatpay"
  instance = google_sql_database_instance.postgres.name
}

resource "google_sql_user" "whatpay_user" {
  name     = "whatpay"
  instance = google_sql_database_instance.postgres.name
  password = random_password.db_password.result
}

resource "random_password" "db_password" {
  length  = 32
  special = true
}

# ─── Redis (Memorystore) ────────────────────────────────

resource "google_redis_instance" "cache" {
  name           = "whatpay-redis-${var.environment}"
  tier           = var.environment == "prod" ? "STANDARD_HA" : "BASIC"
  memory_size_gb = var.environment == "prod" ? 2 : 1
  region         = var.region

  authorized_network = google_compute_network.vpc.id
  connect_mode       = "PRIVATE_SERVICE_ACCESS"

  redis_version = "REDIS_7_0"
}

# ─── Cloud KMS (Encryption Keys) ────────────────────────

resource "google_kms_key_ring" "whatpay" {
  name     = "whatpay-keyring-${var.environment}"
  location = var.region
}

resource "google_kms_crypto_key" "data_key" {
  name     = "data-encryption-key"
  key_ring = google_kms_key_ring.whatpay.id

  rotation_period = "7776000s" # 90 days

  lifecycle {
    prevent_destroy = true
  }
}

# ─── Pub/Sub ─────────────────────────────────────────────

resource "google_pubsub_topic" "payment_events" {
  name = "payment-events-${var.environment}"
}

resource "google_pubsub_subscription" "payment_processor" {
  name  = "payment-processor-${var.environment}"
  topic = google_pubsub_topic.payment_events.name

  ack_deadline_seconds = 30

  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }
}

# ─── Artifact Registry ──────────────────────────────────

resource "google_artifact_registry_repository" "whatpay" {
  location      = var.region
  repository_id = "whatpay-${var.environment}"
  format        = "DOCKER"
}

# ─── Cloud Run (API Service) ────────────────────────────

resource "google_cloud_run_v2_service" "api" {
  name     = "whatpay-api-${var.environment}"
  location = var.region

  template {
    scaling {
      min_instance_count = var.environment == "prod" ? 2 : 0
      max_instance_count = var.environment == "prod" ? 20 : 3
    }

    containers {
      image = "${var.region}-docker.pkg.dev/${var.project_id}/whatpay-${var.environment}/api:latest"

      ports {
        container_port = 3000
      }

      resources {
        limits = {
          cpu    = var.environment == "prod" ? "2" : "1"
          memory = var.environment == "prod" ? "1Gi" : "512Mi"
        }
      }

      env {
        name  = "NODE_ENV"
        value = var.environment == "prod" ? "production" : var.environment
      }

      env {
        name  = "GCP_PROJECT_ID"
        value = var.project_id
      }

      env {
        name  = "GCP_REGION"
        value = var.region
      }
    }

    vpc_access {
      network_interfaces {
        network    = google_compute_network.vpc.name
        subnetwork = google_compute_subnetwork.subnet.name
      }
      egress = "PRIVATE_RANGES_ONLY"
    }
  }
}

# ─── Outputs ─────────────────────────────────────────────

output "api_url" {
  value = google_cloud_run_v2_service.api.uri
}

output "db_connection_name" {
  value = google_sql_database_instance.postgres.connection_name
}

output "redis_host" {
  value = google_redis_instance.cache.host
}
