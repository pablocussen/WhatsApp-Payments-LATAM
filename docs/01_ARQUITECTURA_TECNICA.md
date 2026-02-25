# 01 - Arquitectura Técnica

## Visión General del Sistema

WhatPay opera como una plataforma de pagos event-driven construida sobre
microservicios orquestados por Antigravity Framework, desplegada en Google Cloud
Platform con capacidades de AI/ML provistas por Cloud AI.

---

## Diagrama de Arquitectura de Alto Nivel

```
┌─────────────────────────────────────────────────────────────────┐
│                        USUARIOS                                  │
│  [WhatsApp] ──── [Web App PWA] ──── [Dashboard Comercios]       │
└──────┬──────────────┬────────────────────┬──────────────────────┘
       │              │                    │
       ▼              ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                    API GATEWAY (Cloud Endpoints)                 │
│           Rate Limiting │ Auth │ SSL Termination                 │
└──────┬──────────────┬────────────────────┬──────────────────────┘
       │              │                    │
       ▼              ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│              ANTIGRAVITY ORCHESTRATION LAYER                     │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ WhatsApp │  │ Payment  │  │  User    │  │ Merchant │       │
│  │ Service  │  │ Service  │  │ Service  │  │ Service  │       │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘       │
│       │              │              │              │              │
│  ┌────┴─────┐  ┌────┴─────┐  ┌────┴─────┐  ┌────┴─────┐       │
│  │ Notif.   │  │ Fraud    │  │  KYC     │  │ Settle-  │       │
│  │ Service  │  │ Detector │  │ Service  │  │ ment Svc │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
└──────┬──────────────┬────────────────────┬──────────────────────┘
       │              │                    │
       ▼              ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                     DATA & AI LAYER                              │
│                                                                  │
│  [PostgreSQL]  [Redis]  [Cloud AI]  [Pub/Sub]  [Cloud Storage]  │
│   (Cloud SQL)  (Memorystore)  (Vertex AI)                       │
└─────────────────────────────────────────────────────────────────┘
```

---

## Componentes del Sistema

### 1. Capa de Ingreso (API Gateway)

**Tecnología**: Google Cloud Endpoints + Cloud Armor

| Función | Detalle |
|---|---|
| SSL/TLS Termination | Certificados gestionados por Google |
| Rate Limiting | 100 req/min por usuario, 1000 req/min por comercio |
| Authentication | Validación JWT en cada request |
| WAF | Cloud Armor para protección DDoS y reglas OWASP |
| Routing | Enrutamiento a microservicios vía path-based routing |

### 2. Antigravity Orchestration Layer

Antigravity actúa como el framework de orquestación que coordina los microservicios,
gestiona el ciclo de vida de las transacciones y provee:

- **Service Mesh**: Comunicación segura entre servicios (mTLS)
- **Circuit Breaker**: Tolerancia a fallos con fallback automático
- **Saga Pattern**: Transacciones distribuidas con compensación
- **Event Sourcing**: Registro inmutable de todos los eventos del sistema
- **Auto-scaling**: Escalado basado en métricas de negocio

```typescript
// Ejemplo: Definición de flujo de pago en Antigravity
const paymentFlow = antigravity.defineFlow('process-payment', {
  steps: [
    { service: 'user-service', action: 'validate-sender' },
    { service: 'fraud-detector', action: 'analyze-transaction' },
    { service: 'payment-service', action: 'execute-payment' },
    { service: 'notification-service', action: 'confirm-payment' },
    { service: 'settlement-service', action: 'queue-settlement' }
  ],
  compensation: [
    { service: 'payment-service', action: 'reverse-payment' },
    { service: 'notification-service', action: 'notify-failure' }
  ],
  timeout: 30000, // 30 segundos máximo
  retries: 2
});
```

### 3. Microservicios Core

#### WhatsApp Service
- **Función**: Gestiona la comunicación bidireccional con WhatsApp Business API
- **Tecnología**: Node.js + TypeScript
- **Responsabilidades**:
  - Recibir y parsear mensajes entrantes (webhooks)
  - Enviar mensajes, botones interactivos y plantillas
  - Gestionar sesiones de conversación
  - Procesar comandos de pago (`/pagar`, `/cobrar`, `/saldo`)
  - Generar y enviar enlaces de pago compartibles

```typescript
// Webhook handler para mensajes de WhatsApp
interface WhatsAppMessage {
  from: string;        // Número del remitente (+56XXXXXXXXX)
  type: 'text' | 'interactive' | 'button_reply';
  text?: { body: string };
  interactive?: { button_reply: { id: string; title: string } };
  timestamp: number;
}
```

#### Payment Service
- **Función**: Núcleo del procesamiento de pagos
- **Tecnología**: Node.js + TypeScript
- **Responsabilidades**:
  - Crear, procesar y liquidar transacciones
  - Integración con Transbank WebPay Plus
  - Integración con Khipu (transferencias bancarias)
  - Gestión de billetera virtual (wallet)
  - Generación de enlaces de pago con expiración

#### User Service
- **Función**: Gestión de identidad y perfiles
- **Responsabilidades**:
  - Registro y onboarding de usuarios
  - Verificación de identidad (KYC básico)
  - Gestión de métodos de pago vinculados
  - Preferencias y límites de transacción

#### Merchant Service
- **Función**: Herramientas para comercios
- **Responsabilidades**:
  - Registro y verificación de comercios
  - Dashboard de ventas y analytics
  - Catálogo de productos básico
  - Generación de QR y enlaces de cobro
  - Reportes de liquidación

#### Fraud Detector (Cloud AI)
- **Función**: Detección de fraude en tiempo real
- **Tecnología**: Python (FastAPI) + Vertex AI
- **Responsabilidades**:
  - Scoring de riesgo por transacción (< 200ms)
  - Detección de patrones anómalos
  - Bloqueo automático de transacciones sospechosas
  - Modelo ML entrenado con datos de transacciones chilenas

```python
# Modelo de scoring de fraude
class FraudScoreRequest(BaseModel):
    transaction_id: str
    sender_phone: str
    receiver_phone: str
    amount: Decimal
    currency: str = "CLP"
    device_fingerprint: str
    geolocation: Optional[GeoPoint]
    timestamp: datetime

class FraudScoreResponse(BaseModel):
    score: float          # 0.0 (seguro) - 1.0 (fraude)
    action: str           # "approve" | "review" | "block"
    risk_factors: list[str]
    processing_time_ms: int
```

#### Settlement Service
- **Función**: Liquidación y conciliación de fondos
- **Responsabilidades**:
  - Liquidación a cuentas bancarias de comercios (T+1 / T+2)
  - Conciliación automática con procesadores de pago
  - Generación de reportes contables
  - Cálculo y retención de comisiones

#### Notification Service
- **Función**: Notificaciones multicanal
- **Responsabilidades**:
  - Confirmaciones de pago vía WhatsApp
  - Notificaciones push (PWA)
  - Emails transaccionales
  - Alertas de seguridad

### 4. Capa de Datos

#### PostgreSQL (Cloud SQL)
- **Uso**: Datos transaccionales, usuarios, comercios
- **Configuración**: High Availability con réplica de lectura
- **Backup**: Automático diario + point-in-time recovery

```sql
-- Esquema principal de transacciones
CREATE TABLE transactions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id       UUID NOT NULL REFERENCES users(id),
    receiver_id     UUID NOT NULL REFERENCES users(id),
    amount          BIGINT NOT NULL,           -- En centavos (CLP sin decimales)
    currency        VARCHAR(3) DEFAULT 'CLP',
    status          VARCHAR(20) NOT NULL,      -- pending, processing, completed, failed, reversed
    payment_method  VARCHAR(30) NOT NULL,      -- wallet, webpay, khipu, bank_transfer
    fraud_score     DECIMAL(3,2),
    payment_link_id UUID REFERENCES payment_links(id),
    metadata        JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

CREATE TABLE payment_links (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id     UUID NOT NULL REFERENCES users(id),
    short_code      VARCHAR(10) UNIQUE NOT NULL,  -- Código corto para URL
    amount          BIGINT,                        -- NULL = monto libre
    description     VARCHAR(500),
    expires_at      TIMESTAMPTZ,
    max_uses        INT DEFAULT 1,
    current_uses    INT DEFAULT 0,
    is_active       BOOLEAN DEFAULT true,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para queries frecuentes
CREATE INDEX idx_transactions_sender ON transactions(sender_id, created_at DESC);
CREATE INDEX idx_transactions_receiver ON transactions(receiver_id, created_at DESC);
CREATE INDEX idx_transactions_status ON transactions(status) WHERE status = 'pending';
CREATE INDEX idx_payment_links_code ON payment_links(short_code) WHERE is_active = true;
```

#### Redis (Memorystore)
- **Uso**: Cache, sesiones de conversación, rate limiting, locks distribuidos
- **TTL de sesiones**: 30 minutos de inactividad
- **Cache de usuario**: 5 minutos

#### Cloud Pub/Sub
- **Uso**: Mensajería asíncrona entre servicios
- **Topics principales**:
  - `payment.created` - Nueva transacción iniciada
  - `payment.completed` - Pago exitoso
  - `payment.failed` - Pago fallido
  - `fraud.alert` - Alerta de fraude detectada
  - `settlement.ready` - Liquidación lista para procesar
  - `user.kyc.verified` - Usuario verificado

---

## Integraciones Externas

### WhatsApp Business API (Cloud API)

```
Versión: Cloud API v18.0+
Tipo de cuenta: WhatsApp Business Platform
Proveedor: Meta (directo, sin BSP intermediario)

Funcionalidades utilizadas:
├── Messages API (envío de mensajes)
├── Webhooks (recepción de mensajes)
├── Interactive Messages (botones, listas)
├── Template Messages (mensajes aprobados)
├── Media Messages (imágenes de recibos)
└── Flows (formularios inline - para pago)
```

### Procesadores de Pago Chile

| Procesador | Uso | Costo aprox. |
|---|---|---|
| **Transbank WebPay Plus** | Tarjetas de crédito/débito | 2.49% + IVA |
| **Khipu** | Transferencias bancarias directas | 1.2% + IVA |
| **Wallet interno** | Saldo precargado (P2P) | Sin costo de procesador |

### Cloud AI (Vertex AI)

- **AutoML Tables**: Modelo de detección de fraude
- **Natural Language AI**: Procesamiento de mensajes de chat (intención de pago)
- **Recommendations AI**: Sugerencias de pago recurrente

---

## Requisitos No Funcionales

| Requisito | Objetivo | Medición |
|---|---|---|
| **Disponibilidad** | 99.95% uptime | Monitoreo 24/7 |
| **Latencia** | < 500ms respuesta de API | P95 |
| **Throughput** | 1,000 TPS en peak | Load testing |
| **Seguridad** | PCI DSS SAQ-A compatible | Auditoría anual |
| **Recuperación** | RPO < 1 hora, RTO < 4 horas | DR drills trimestrales |
| **Escalabilidad** | Horizontal, auto-scaling | Cloud Run min/max instances |

---

## Ambientes

| Ambiente | Propósito | Infraestructura |
|---|---|---|
| `development` | Desarrollo local | Docker Compose |
| `staging` | QA y pruebas de integración | GCP proyecto separado |
| `production` | Producción | GCP con HA multi-zona |

---

## Decisiones de Arquitectura (ADR)

### ADR-001: Event Sourcing para Transacciones
- **Decisión**: Usar event sourcing para el registro de transacciones
- **Razón**: Auditoría completa, capacidad de replay, requisito regulatorio CMF
- **Consecuencia**: Mayor complejidad, pero trazabilidad total

### ADR-002: Cloud API de WhatsApp (no On-Premise)
- **Decisión**: Usar Cloud API de Meta, no la versión On-Premise
- **Razón**: Menor costo operacional, escalado automático, sin infraestructura propia
- **Consecuencia**: Dependencia de Meta, pero menor overhead operacional

### ADR-003: Antigravity como Orquestador
- **Decisión**: Usar Antigravity para orquestación de microservicios
- **Razón**: Saga pattern nativo, circuit breaker integrado, observabilidad built-in
- **Consecuencia**: Curva de aprendizaje del framework, pero robustez en producción

### ADR-004: PostgreSQL sobre NoSQL
- **Decisión**: PostgreSQL como base de datos principal
- **Razón**: Consistencia ACID obligatoria para transacciones financieras, soporte JSON nativo
- **Consecuencia**: Escalamiento vertical más limitado, pero integridad de datos garantizada
