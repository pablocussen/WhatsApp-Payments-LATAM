# Changelog

All notable changes to WhatPay are documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [0.2.0] — 2026-02-26

### Security
- **PIN in session**: Registration flow now stores a bcrypt hash (`pinHash`) in the Redis session instead of the raw PIN in plaintext. Resolves a 30-minute window where a compromised session could expose the user's PIN.
- **PIN change via UserService**: `changePin` in `bot.service.ts` now delegates to `UserService.setNewPin()`, which validates PIN strength with `isSecurePin()` and resets `pinAttempts` atomically. Previously, the Prisma call was made directly, bypassing validation.
- **Khipu webhook validation**: `verifyNotification()` now validates the notification token format (`/^[a-zA-Z0-9_-]{6,}$/`) instead of the trivially bypassable `token.length > 0 && apiVersion === '1.3'` check.
- **WebPay & Khipu wallet credit**: Callbacks now actually credit the user's wallet. Previously, the wallet credit step was a `TODO` comment. Redis mappings (`topup:webpay:{buyOrder}`, `topup:khipu:{paymentId}`) are stored at initiation (TTL 1h) and consumed atomically on callback to prevent double-credit.

### Added
- **Swagger UI** at `/api/docs` with full OpenAPI 3.1 spec (`docs/openapi.json`). Served via CDN; no additional npm dependency.
- **GitHub Actions CI** (`.github/workflows/ci.yml`): runs TypeScript typecheck, ESLint, Jest, and build on every push/PR to `master`/`main`.
- **Health check improvements** (`/health`): now pings Redis and runs `SELECT 1` against PostgreSQL. Returns `503 degraded` if either dependency is unreachable, enabling Cloud Run's liveness probe to detect partial failures.
- **README rewrite**: badges (CI, tests, TypeScript, GCP, Swagger, Node.js), architecture ASCII diagram, full API endpoints table, security layers table, and fee structure.

### Fixed
- **Content-Security-Policy**: Swagger UI route overrides Helmet's default CSP to allow inline scripts and unpkg.com CDN. All other routes retain the strict Helmet CSP.
- **Jest config**: Migrated from `jest.config.ts` (required `ts-node`) to `jest.config.js` (CommonJS), eliminating the `ts-node` dependency for test startup. Updated `test`, `test:watch`, `test:coverage` scripts accordingly.
- **Coverage provider**: Switched to `coverageProvider: 'v8'` to avoid `@babel/traverse` instrumentation. Results: 75% statements, 96% branches, 79% functions.
- **ESLint zero errors**: Removed unused variables (`log`, `AuthenticatedRequest`, `LOCKOUT_DURATION_MS`, `P2P_FREE`, `CreatePaymentParams`, `PaymentResult`, `AUTH_TAG_LENGTH`, `merchants`), fixed `no-case-declarations` in `bot.service.ts`, and removed all `no-useless-escape` occurrences.

### Changed
- Landing page (`cussen.cl/whatpay/`): fixed acentos ("Próximamente", "Cómo funciona"), added animated "API en producción · GCP Cloud Run" live badge, GitHub links in nav and footer, and email waitlist form (Formspree).

---

## [0.1.0] — 2026-01-15

### Added
- Initial WhatsApp bot with conversational payment flows (P2P, balance, history, profile).
- JWT authentication with `jwt.middleware.ts`; PIN-based login with bcrypt and lockout after 3 failed attempts.
- KYC levels: BASIC / INTERMEDIATE / FULL with per-transaction and monthly limits.
- Payment methods: wallet-to-wallet, WebPay (credit/debit via Transbank), and Khipu (bank transfer).
- Payment links: create shareable links with optional amount, description, expiry, and max-use cap.
- Merchant dashboard: revenue, volume, and settlement reports.
- AES-256-GCM field encryption for PII (RUT, email, phone) with HMAC-indexed searchable fields.
- Redis-backed rate limiting and conversation sessions (30-min TTL).
- Fraud detection: velocity checks (5 transactions/hour) and amount anomaly detection (3× average).
- REST API with Express, Zod validation, and structured logging (Winston).
- 73 unit tests across 5 suites (crypto, auth, payments, formatting, WhatsApp templates).
- PostgreSQL schema with Prisma ORM; Redis for sessions, rate-limiting, and top-up mappings.
- Deployed to GCP Cloud Run (`southamerica-west1`).
