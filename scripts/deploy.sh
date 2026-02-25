#!/bin/bash
# ═══════════════════════════════════════════════════════════
#  WhatPay - Deploy Script
#  Usage: ./scripts/deploy.sh [staging|production]
# ═══════════════════════════════════════════════════════════

set -euo pipefail

ENVIRONMENT=${1:-staging}
PROJECT_ID="whatpay-${ENVIRONMENT}"
REGION="southamerica-west1"
SERVICE_NAME="whatpay-api-${ENVIRONMENT}"
REPO="${REGION}-docker.pkg.dev/${PROJECT_ID}/whatpay-${ENVIRONMENT}/api"

echo "========================================"
echo "  WhatPay Deploy → ${ENVIRONMENT}"
echo "========================================"

# 1. Run tests
echo "[1/6] Running tests..."
npm test

# 2. Build TypeScript
echo "[2/6] Building..."
npm run build

# 3. Build Docker image
echo "[3/6] Building Docker image..."
TAG=$(git rev-parse --short HEAD)
docker build -t "${REPO}:${TAG}" -t "${REPO}:latest" -f infra/docker/Dockerfile .

# 4. Push to Artifact Registry
echo "[4/6] Pushing image..."
docker push "${REPO}:${TAG}"
docker push "${REPO}:latest"

# 5. Deploy to Cloud Run
echo "[5/6] Deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --image "${REPO}:${TAG}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --platform managed \
  --allow-unauthenticated \
  --port 3000 \
  --min-instances $([ "$ENVIRONMENT" = "production" ] && echo "2" || echo "0") \
  --max-instances $([ "$ENVIRONMENT" = "production" ] && echo "20" || echo "3") \
  --set-env-vars "NODE_ENV=${ENVIRONMENT}" \
  --quiet

# 6. Verify
echo "[6/6] Verifying deployment..."
URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --region "${REGION}" \
  --project "${PROJECT_ID}" \
  --format 'value(status.url)')

HEALTH=$(curl -s "${URL}/health" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")

if [ "$HEALTH" = "ok" ]; then
  echo ""
  echo "========================================"
  echo "  Deploy SUCCESS"
  echo "  URL: ${URL}"
  echo "  Version: ${TAG}"
  echo "========================================"
else
  echo "DEPLOY FAILED - Health check returned: ${HEALTH}"
  exit 1
fi
