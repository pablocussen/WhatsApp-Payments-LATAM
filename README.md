# WhatPay - Pagos Integrados via WhatsApp para Latinoamérica

> Plataforma de pagos peer-to-peer y comercio integrada nativamente con WhatsApp,
> construida con Antigravity Framework y Cloud AI. Inicio en Chile, expansión LATAM.

---

## Visión del Proyecto

WhatPay permite a cualquier persona en Chile enviar y recibir pagos directamente
desde una conversación de WhatsApp, sin necesidad de descargar otra aplicación.
Comercios pequeños pueden cobrar compartiendo un enlace, y los usuarios pagan
con un toque y verificación biométrica o PIN.

## Problema que Resuelve

- **67% de los chilenos** usa WhatsApp como canal principal de comunicación
- Los comercios informales y PYMES pierden ventas por fricción en el cobro
- Las transferencias bancarias requieren datos complejos (RUT, banco, tipo cuenta, número)
- No existe una solución nativa de pagos dentro de WhatsApp para Chile

## Propuesta de Valor

| Para Usuarios | Para Comercios |
|---|---|
| Pagar desde el chat sin salir de WhatsApp | Cobrar con un enlace compartible |
| Autenticación biométrica o PIN de 6 dígitos | Dashboard de ventas en tiempo real |
| Sin descargar apps adicionales | Integración con inventario básico |
| Historial de transacciones en el chat | Liquidación en 24-48 horas |

## Stack Tecnológico Principal

| Capa | Tecnología |
|---|---|
| **Framework Core** | Antigravity (orquestación de microservicios) |
| **AI/ML** | Google Cloud AI (detección de fraude, NLP para chatbot) |
| **Backend** | Node.js + TypeScript / Python (FastAPI para ML) |
| **Base de Datos** | PostgreSQL (transaccional) + Redis (cache/sesiones) |
| **Mensajería** | WhatsApp Business API (Cloud API) |
| **Pagos** | Transbank WebPay Plus + Khipu + transferencias bancarias |
| **Infraestructura** | Google Cloud Platform (Cloud Run, Cloud SQL, Pub/Sub) |
| **Seguridad** | OAuth 2.0, WebAuthn (biometría), cifrado AES-256 |
| **Monitoreo** | Cloud Monitoring + Grafana + PagerDuty |

## Estructura del Proyecto

```
WhatsApp-Payments-LATAM/
├── README.md                              # Este archivo
├── package.json                           # Dependencias y scripts
├── tsconfig.json                          # Configuración TypeScript
├── jest.config.ts                         # Configuración de tests
├── .eslintrc.json / .prettierrc           # Linting y formato
├── .env.example                           # Variables de entorno (template)
│
├── docs/
│   ├── 01_ARQUITECTURA_TECNICA.md         # Arquitectura y diseño del sistema
│   ├── 02_MARCO_LEGAL_CHILE.md            # Regulaciones y compliance Chile
│   ├── 03_FLUJOS_UX.md                    # Experiencia de usuario paso a paso
│   ├── 04_MODELO_NEGOCIO.md               # Modelo de ingresos y proyecciones
│   ├── 05_SEGURIDAD_AUTH.md               # Seguridad y autenticación
│   └── 06_CRONOGRAMA_TESTING.md           # Timeline y plan de pruebas
│
├── src/
│   ├── api/
│   │   ├── server.ts                      # Express app + startup
│   │   ├── webhook.routes.ts              # WhatsApp webhook (GET/POST)
│   │   ├── user.routes.ts                 # /users (register, login, profile)
│   │   ├── payment.routes.ts              # /payments (pay, links, wallet)
│   │   ├── merchant.routes.ts             # /merchants (dashboard, settlement)
│   │   └── topup.routes.ts               # /topup (WebPay, Khipu callbacks)
│   ├── services/
│   │   ├── bot.service.ts                 # Motor conversacional WhatsApp (stateful)
│   │   ├── whatsapp.service.ts            # WhatsApp Cloud API client
│   │   ├── user.service.ts                # Registro, KYC, PIN, perfil
│   │   ├── wallet.service.ts              # Saldo, crédito, débito, transferencia
│   │   ├── transaction.service.ts         # Pagos P2P, comisiones, historial
│   │   ├── payment.service.ts             # Cálculo fees, validación límites
│   │   ├── payment-link.service.ts        # Enlaces de cobro compartibles
│   │   ├── merchant.service.ts            # Dashboard, liquidación, reportes
│   │   ├── fraud.service.ts               # Detección de fraude (reglas + AI)
│   │   ├── transbank.service.ts           # Integración WebPay Plus
│   │   ├── khipu.service.ts               # Integración Khipu (transferencias)
│   │   └── index.ts                       # Barrel exports
│   ├── middleware/
│   │   ├── jwt.middleware.ts              # JWT auth + KYC level guard
│   │   ├── auth.middleware.ts             # PIN validation + rate limiting
│   │   └── error.middleware.ts            # Error handler centralizado
│   ├── models/
│   │   └── schema.prisma                  # Esquema DB (Users, Wallets, Tx, Links)
│   ├── utils/
│   │   ├── crypto.ts                      # AES-256, bcrypt, RUT, HMAC
│   │   ├── format.ts                      # Formateo CLP, teléfono, fechas
│   │   └── index.ts                       # Barrel exports
│   └── config/
│       ├── environment.ts                 # Validación de env vars (Zod)
│       ├── database.ts                    # Prisma + Redis + sesiones
│       └── logger.ts                      # Structured logging
│
├── tests/
│   ├── unit/
│   │   ├── crypto.test.ts                 # Tests cifrado, RUT, PIN
│   │   ├── auth.test.ts                   # Tests validación PIN seguro
│   │   ├── format.test.ts                 # Tests formateo CLP, teléfono
│   │   └── payment.test.ts               # Tests comisiones, límites
│   └── integration/
│       └── api.test.ts                    # Tests de API routes
│
├── infra/
│   ├── terraform/
│   │   └── main.tf                        # GCP: Cloud Run, SQL, Redis, KMS, Pub/Sub
│   └── docker/
│       ├── Dockerfile                     # Multi-stage build (prod)
│       └── docker-compose.yml             # Dev: Postgres + Redis + API
│
└── scripts/
    ├── deploy.sh                          # Deploy a staging/production
    └── cloudbuild.yaml                    # CI/CD pipeline (Cloud Build)
```

## Mercado Objetivo Inicial: Chile

- **Población**: 19.5 millones
- **Penetración smartphones**: 92%
- **Usuarios WhatsApp**: ~13 millones (67%)
- **Bancarización**: 87% (una de las más altas de LATAM)
- **Marco regulatorio**: CMF (Comisión para el Mercado Financiero), Ley Fintech 21.521

## Roadmap de Expansión

| Fase | Mercado | Timeline |
|---|---|---|
| **Fase 1** | Chile (MVP) | Meses 1-6 |
| **Fase 2** | Chile (escala) + Colombia | Meses 7-12 |
| **Fase 3** | Perú + Argentina | Meses 13-18 |
| **Fase 4** | Brasil + México | Meses 19-24 |

## Inicio Rápido (Desarrollo)

```bash
# Clonar repositorio
git clone https://cussen.cl/whatpay
cd WhatsApp-Payments-LATAM

# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env
# Editar .env con credenciales de WhatsApp Business API, Transbank, etc.

# Levantar servicios locales (Docker)
npm run docker:up

# Crear tablas en la base de datos
npm run db:push

# Ejecutar en modo desarrollo
npm run dev

# Correr tests
npm test
```

## Scripts Disponibles

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Servidor en modo desarrollo (hot reload) |
| `npm run build` | Compilar TypeScript a JavaScript |
| `npm start` | Ejecutar build de producción |
| `npm test` | Correr 73 tests (unit + integración) |
| `npm run test:coverage` | Tests con reporte de cobertura |
| `npm run lint` | Linting con ESLint |
| `npm run docker:up` | Levantar PostgreSQL + Redis locales |
| `npm run db:push` | Sincronizar schema Prisma con DB |
| `npm run deploy:staging` | Deploy a staging (GCP Cloud Run) |

## Estado del Proyecto

**Fase actual**: MVP en desarrollo - Core funcional
**Tests**: 73/73 pasando (5 suites)
**TypeScript**: 0 errores de compilación
**Auditoría de seguridad**: P0 y P1 resueltos

### Seguridad implementada
- AES-256-GCM para datos sensibles (RUT, cuentas bancarias)
- bcrypt cost 12 para PIN hashing
- OTP con `crypto.randomInt` (CSPRNG)
- Transacciones atómicas con `SELECT FOR UPDATE` (anti double-spending)
- Rate limiting distribuido con Redis (MULTI/EXEC atómico)
- Idempotencia en webhooks (deduplicación por message ID)
- JWT con guards por nivel KYC
- Detección de fraude con 5 reglas + scoring

**Última actualización**: Febrero 2026

---

*Documentación detallada en la carpeta [docs/](docs/)*

*Proyecto desarrollado por Pablo Cussen — [cussen.cl/whatpay](https://cussen.cl/whatpay)*
