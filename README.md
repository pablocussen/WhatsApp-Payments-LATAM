# WhatPay — Pagos por WhatsApp en Chile

> Plataforma de pagos peer-to-peer integrada nativamente con WhatsApp.
> Backend en Node.js + TypeScript, desplegado en GCP Cloud Run (Santiago).

[![Tests](https://img.shields.io/badge/tests-527%2F527%20passing-25D366)](https://github.com/pablocussen/WhatsApp-Payments-LATAM/actions/workflows/ci.yml)
[![Coverage](https://img.shields.io/badge/coverage-100%25%20branches-brightgreen)](https://github.com/pablocussen/WhatsApp-Payments-LATAM)
[![Cloud Build](https://img.shields.io/badge/CI%2FCD-Cloud%20Build-4285F4?logo=googlecloud&logoColor=white)](https://console.cloud.google.com/cloud-build/builds?project=whatpay-cl)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![GCP Cloud Run](https://img.shields.io/badge/deployed-GCP%20Cloud%20Run-4285F4?logo=googlecloud&logoColor=white)](https://whatpay-api-930472612593.southamerica-west1.run.app/health)
[![API Docs](https://img.shields.io/badge/API-Swagger%20Docs-85EA2D?logo=swagger&logoColor=black)](https://whatpay-api-930472612593.southamerica-west1.run.app/api/docs)
[![Node](https://img.shields.io/badge/Node.js-20+-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-Portfolio%20Project-orange)](https://cussen.cl/whatpay)

---

## Demo en producción

| Recurso | URL |
|---------|-----|
| 🟢 API Health | [`/health`](https://whatpay-api-930472612593.southamerica-west1.run.app/health) |
| 📘 Swagger Docs | [`/api/docs`](https://whatpay-api-930472612593.southamerica-west1.run.app/api/docs) |
| 🌐 Landing Page | [`cussen.cl/whatpay`](https://cussen.cl/whatpay/) |

---

## El Problema

- **67% de los chilenos** usa WhatsApp como canal principal de comunicación
- Los comercios informales y PYMES pierden ventas por fricción en el cobro
- Las transferencias bancarias requieren datos complejos (RUT, banco, tipo de cuenta, número)
- No existe una solución nativa de pagos dentro de WhatsApp para Chile

## La Solución

WhatPay permite enviar y recibir pagos **directamente desde una conversación de WhatsApp**, sin salir de la app. Los comercios cobran compartiendo un link; los usuarios pagan con un toque y su PIN de 6 dígitos.

---

## Arquitectura

```
┌──────────────────────────────────────────────────────────────────┐
│                     WhatsApp Cloud API (Meta)                    │
└─────────────────────────────┬────────────────────────────────────┘
                              │ HTTPS webhook
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│         GCP Cloud Run  ·  Node.js + Express + TypeScript         │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────────┐│
│  │  BotService │  │PaymentService│  │  FraudService (AI rules) ││
│  │ (FSM conv.) │  │(P2P, links)  │  │  5 reglas + ML scoring   ││
│  └──────┬──────┘  └──────┬───────┘  └──────────────────────────┘│
│         │                │                                       │
│  ┌──────▼──────┐  ┌──────▼───────┐  ┌──────────────────────────┐│
│  │JWT Middleware│  │Auth Middleware│  │  Error Middleware        ││
│  │ KYC guards  │  │PIN + rate lmt │  │  Zod + AppError types   ││
│  └─────────────┘  └──────────────┘  └──────────────────────────┘│
└───────────┬──────────────────────┬───────────────────────────────┘
            │                      │
   ┌────────▼────────┐   ┌────────▼────────┐   ┌──────────────────┐
   │   Cloud SQL     │   │  Memorystore    │   │   Cloud KMS      │
   │  PostgreSQL 16  │   │   Redis 7       │   │  AES-256 keys    │
   │  Wallets · Tx   │   │  Sessions · OTP │   │  90-day rotation │
   │  Users · Links  │   │  Rate limiting  │   └──────────────────┘
   └─────────────────┘   └─────────────────┘
            │
   ┌────────▼────────────────────────────────┐
   │          Integraciones de Pago          │
   │  Transbank WebPay Plus  ·  Khipu        │
   │  (crédito/débito)       (transferencia) │
   └─────────────────────────────────────────┘
```

---

## Stack Tecnológico

| Capa | Tecnología |
|------|-----------|
| **Runtime** | Node.js 20 + TypeScript 5.6 (strict mode) |
| **Framework** | Express 4 · Zod (validación) · Prisma ORM |
| **Base de Datos** | PostgreSQL 16 (Cloud SQL) + Redis 7 (Memorystore) |
| **Mensajería** | WhatsApp Business Cloud API |
| **Pagos** | Transbank WebPay Plus · Khipu (transferencias bancarias) |
| **Infraestructura** | GCP Cloud Run · Cloud SQL · Memorystore · Pub/Sub · KMS |
| **IaC** | Terraform (main.tf — VPC, Cloud Run, SQL, Redis, KMS, Pub/Sub) |
| **CI/CD** | GitHub Actions + Google Cloud Build |
| **Seguridad** | JWT · bcrypt cost 12 · AES-256-GCM · WebAuthn · Rate limiting Redis |
| **Testing** | Jest 29 · ts-jest · v8 coverage (527 tests, 29 suites, 100% branches) |

---

## API Endpoints

| Método | Endpoint | Auth | Descripción |
|--------|----------|------|-------------|
| `GET` | `/` | — | Info del servicio |
| `GET` | `/health` | — | Estado del servicio (Redis + DB) |
| `GET` | `/api/docs` | — | Swagger UI interactivo |
| `POST` | `/api/v1/users/register` | — | Registro (RUT + PIN 6 dígitos) |
| `POST` | `/api/v1/users/login` | — | PIN → JWT (30min, bloqueo 3 intentos) |
| `GET` | `/api/v1/users/me` | JWT | Perfil + saldo + estadísticas |
| `GET` | `/api/v1/payments/wallet/balance` | JWT | Saldo del wallet |
| `POST` | `/api/v1/payments/pay` | JWT | Pago P2P (gratis, atómico, anti double-spend) |
| `POST` | `/api/v1/payments/links` | JWT | Crear link de cobro |
| `GET` | `/api/v1/payments/links` | JWT | Listar mis links activos |
| `GET` | `/api/v1/payments/links/:code` | — | Resolver link de cobro (público) |
| `DELETE` | `/api/v1/payments/links/:id` | JWT | Desactivar link de cobro |
| `GET` | `/api/v1/payments/history` | JWT | Historial de transacciones |
| `POST` | `/api/v1/topup/webpay` | JWT | Iniciar recarga Transbank WebPay |
| `POST` | `/api/v1/topup/webpay/callback` | — | Callback Transbank (acredita wallet) |
| `POST` | `/api/v1/topup/khipu` | JWT | Iniciar recarga Khipu |
| `POST` | `/api/v1/topup/khipu/notify` | — | Notificación Khipu (acredita wallet) |
| `GET` | `/api/v1/merchants/dashboard` | JWT+KYC | Dashboard comercio (INTERMEDIATE+) |
| `GET` | `/api/v1/merchants/transactions` | JWT+KYC | Transacciones paginadas |
| `GET` | `/api/v1/merchants/settlement` | JWT+KYC | Reporte de liquidación |
| `GET` | `/api/v1/webhook` | — | Verificación webhook Meta |
| `POST` | `/api/v1/webhook` | — | Mensajes WhatsApp (deduplicado, HMAC) |
| `GET` | `/c/:code` | — | Redirect a link de cobro |

> Documentación interactiva completa: [`/api/docs`](https://whatpay-api-930472612593.southamerica-west1.run.app/api/docs)

---

## Seguridad Implementada

| Capa | Implementación |
|------|---------------|
| **Datos en reposo** | AES-256-GCM (RUT, cuentas bancarias) con Cloud KMS |
| **Autenticación** | bcrypt cost 12 para PIN · JWT RS256 · WebAuthn biométrico |
| **Brute force** | Redis MULTI/EXEC atómico · 3 intentos → bloqueo 15 min |
| **Anti double-spending** | PostgreSQL `SELECT FOR UPDATE` en transferencias |
| **Idempotencia** | Deduplicación webhook por message ID · Redis DEL antes de acreditar |
| **Detección fraude** | 5 reglas + ML scoring · Bloqueo automático P0 |
| **Secretos** | Google Secret Manager · rotación de llaves cada 90 días |
| **Red** | VPC privada · Cloud Run sin IP pública · TLS end-to-end |

---

## Modelo de Comisiones

| Método | Comisión | Fijo |
|--------|----------|------|
| P2P Wallet | **Gratis** | $0 |
| WebPay Débito | 1.8% | $50 |
| WebPay Crédito | 2.8% | $50 |
| Khipu (transferencia) | 1.0% | $0 |

---

## Inicio Rápido

```bash
# Clonar
git clone https://github.com/pablocussen/WhatsApp-Payments-LATAM.git
cd WhatsApp-Payments-LATAM

# Instalar
npm install

# Configurar entorno
cp .env.example .env
# Completar con credenciales de WhatsApp API, Transbank, Khipu, etc.

# Levantar servicios locales
npm run docker:up       # PostgreSQL 16 + Redis 7

# Crear schema
npm run db:push

# Desarrollo (hot reload)
npm run dev

# Tests
npm test                # 527/527
npm run test:coverage   # con reporte de cobertura (100% branches)
```

### Variables de entorno requeridas

```bash
DATABASE_URL=postgresql://...   # REQUERIDO
JWT_SECRET=...                  # REQUERIDO (mín. 32 chars)
```

El resto tiene defaults seguros para desarrollo. Ver `.env.example` para todas las variables.

---

## Scripts

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Servidor desarrollo (hot reload con tsx) |
| `npm run build` | Compilar TypeScript → dist/ |
| `npm start` | Ejecutar build de producción |
| `npm test` | 527 tests (29 suites — unit + integración) |
| `npm run test:coverage` | Tests + reporte de cobertura (v8, 100% branches) |
| `npm run lint` | ESLint en src/ |
| `npm run docker:up` | Levantar PostgreSQL + Redis locales |
| `npm run db:push` | Sincronizar schema Prisma con DB |
| `npm run deploy:staging` | Deploy a staging (GCP Cloud Run) |
| `npm run deploy:prod` | Deploy a producción |

---

## Estructura del Proyecto

```
WhatsApp-Payments-LATAM/
├── .github/workflows/ci.yml    # GitHub Actions CI (type-check + tests + build)
├── src/
│   ├── api/
│   │   ├── server.ts           # Express app · /health · /api/docs · routes
│   │   ├── webhook.routes.ts   # WhatsApp webhook (deduplicación Redis)
│   │   ├── user.routes.ts      # /users — registro, login, perfil, KYC
│   │   ├── payment.routes.ts   # /payments — P2P, links, wallet, historial
│   │   ├── merchant.routes.ts  # /merchants — dashboard, liquidación
│   │   └── topup.routes.ts     # /topup — WebPay + Khipu (Redis mapping)
│   ├── services/
│   │   ├── bot.service.ts      # FSM conversacional WhatsApp (18 estados)
│   │   ├── user.service.ts     # Registro, KYC, PIN (setNewPin, setKycLevel)
│   │   ├── wallet.service.ts   # Saldo, crédito/débito, transferencias atómicas
│   │   ├── transaction.service.ts  # Pagos P2P, comisiones, historial
│   │   ├── payment-link.service.ts # Links cortos (whatpay.cl/c/{code})
│   │   ├── fraud.service.ts    # 5 reglas + scoring · bloqueo automático
│   │   ├── transbank.service.ts    # Transbank WebPay Plus SDK
│   │   └── khipu.service.ts    # Khipu API (HMAC-SHA256 auth)
│   ├── middleware/
│   │   ├── jwt.middleware.ts   # JWT auth · requireKyc guards
│   │   ├── auth.middleware.ts  # PIN validation · rate limiting Redis
│   │   └── error.middleware.ts # Errores tipados (AppError hierarchy)
│   ├── models/schema.prisma    # Users · Wallets · Transactions · PaymentLinks
│   ├── utils/
│   │   ├── crypto.ts           # AES-256-GCM · bcrypt · RUT · HMAC · OTP
│   │   └── format.ts           # CLP · teléfono · mensajes WhatsApp
│   └── config/
│       ├── environment.ts      # Zod schema · validación en startup · fail-fast
│       ├── database.ts         # Prisma + Redis + sessions
│       └── logger.ts           # Structured logging
├── tests/
│   ├── unit/                   # 28 suites · 527 tests (todos los servicios + middlewares)
│   └── integration/            # api.test.ts (supertest, endpoints reales)
├── docs/
│   ├── openapi.json            # OpenAPI 3.1 spec (servido en /api/docs)
│   └── *.md                    # Arquitectura, legal, UX, negocio, seguridad
├── infra/
│   ├── terraform/main.tf       # GCP: Cloud Run · SQL · Redis · KMS · Pub/Sub
│   └── docker/                 # Dockerfile multi-stage · docker-compose.yml
└── scripts/
    ├── deploy.sh               # Deploy staging/prod con health check
    └── cloudbuild.yaml         # Cloud Build CI/CD pipeline
```

---

## Roadmap

| Fase | Mercado | Estado |
|------|---------|--------|
| **MVP** | Chile — Core funcional | 🟡 En desarrollo |
| **Fase 2** | Chile (escala) + Colombia | 📋 Planificado |
| **Fase 3** | Perú + Argentina | 📋 Planificado |
| **Fase 4** | Brasil + México | 📋 Planificado |

---

## Estado

- **Tests**: 527/527 pasando (29 suites — todos los servicios + middlewares + rutas HTTP, **100% branch coverage**)
- **TypeScript**: 0 errores (strict mode)
- **Seguridad**: PIN como bcrypt hash, RUT como HMAC-SHA256, SELECT FOR UPDATE anti double-spend, idempotencia en recargas, bloqueo de cuenta tras 3 intentos
- **API Docs**: Swagger UI en `/api/docs` con OpenAPI 3.1 spec completo
- **Producción**: API live en GCP Cloud Run — región `southamerica-west1` (Santiago)
- **Bot**: Máquina de estados con 18 estados — registro, pagos P2P, cobros, change PIN, historial, perfil, KYC upgrade
- **Infraestructura**: Terraform provisioned (VPC, Cloud SQL, Memorystore, KMS, Pub/Sub, Cloud Run)

---

*Proyecto desarrollado por [Pablo Cussen](https://cussen.cl) — [cussen.cl/whatpay](https://cussen.cl/whatpay)*

*Documentación técnica detallada en [`docs/`](docs/)*
