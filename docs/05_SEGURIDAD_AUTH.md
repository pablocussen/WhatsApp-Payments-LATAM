# 05 - Seguridad y Autenticación

## Visión General de Seguridad

WhatPay maneja dinero real y datos financieros sensibles. La seguridad no es una
feature opcional — es el fundamento del sistema. Este documento detalla las capas
de protección, métodos de autenticación y protocolos de respuesta a incidentes.

---

## 1. Arquitectura de Seguridad por Capas

```
┌─────────────────────────────────────────────────┐
│  CAPA 1: PERÍMETRO                               │
│  Cloud Armor (WAF) + DDoS Protection             │
│  Rate Limiting + IP Allowlisting (admin)         │
├─────────────────────────────────────────────────┤
│  CAPA 2: TRANSPORTE                              │
│  TLS 1.3 obligatorio + Certificate Pinning       │
│  mTLS entre microservicios                       │
├─────────────────────────────────────────────────┤
│  CAPA 3: AUTENTICACIÓN                           │
│  JWT + PIN 6 dígitos + Biometría (WebAuthn)      │
│  MFA obligatorio para transacciones              │
├─────────────────────────────────────────────────┤
│  CAPA 4: AUTORIZACIÓN                            │
│  RBAC (Role-Based Access Control)                │
│  Límites de transacción por nivel KYC            │
├─────────────────────────────────────────────────┤
│  CAPA 5: DATOS                                   │
│  Cifrado AES-256 en reposo                       │
│  Tokenización de tarjetas (Transbank)            │
│  Hash bcrypt para PINs                           │
├─────────────────────────────────────────────────┤
│  CAPA 6: MONITOREO                               │
│  Cloud AI Fraud Detection (tiempo real)          │
│  Logging inmutable + alertas automáticas         │
│  SIEM (Security Information and Event Mgmt)      │
└─────────────────────────────────────────────────┘
```

---

## 2. Autenticación de Usuarios

### 2.1 Flujo de Autenticación

```
Registro inicial:
  Número WhatsApp → Verificación OTP (Meta) → RUT → PIN 6 dígitos → Cuenta activa

Autenticación para pago:
  Comando de pago → Verificación de sesión → PIN o Biometría → Transacción autorizada

Sesión:
  JWT con TTL 30 minutos → Refresh automático si hay actividad → Re-auth para pagos
```

### 2.2 PIN de 6 Dígitos

| Aspecto | Implementación |
|---|---|
| **Longitud** | 6 dígitos numéricos |
| **Almacenamiento** | Hash bcrypt (cost factor 12), nunca en texto plano |
| **Intentos máximos** | 3 intentos fallidos → bloqueo temporal (15 min) |
| **Bloqueo permanente** | 5 bloqueos temporales en 24h → bloqueo total + verificación de identidad |
| **Cambio de PIN** | Requiere PIN actual + OTP por SMS |
| **Recuperación** | Verificación de identidad completa (cédula + selfie) |
| **Restricciones** | No permite secuencias (123456), repeticiones (111111), ni fechas de nacimiento |

```typescript
// Validación de PIN seguro
function isSecurePin(pin: string): boolean {
  if (pin.length !== 6) return false;
  if (/^(\d)\1{5}$/.test(pin)) return false;           // No repeticiones (111111)
  if (/^(012345|123456|234567|345678|456789)$/.test(pin)) return false; // No secuencias
  if (/^(987654|876543|765432|654321|543210)$/.test(pin)) return false; // No secuencias inversas
  return true;
}
```

### 2.3 Autenticación Biométrica (WebAuthn/FIDO2)

Para dispositivos compatibles, WhatPay ofrece autenticación biométrica como
alternativa al PIN:

| Aspecto | Detalle |
|---|---|
| **Protocolo** | WebAuthn (FIDO2) |
| **Biometría soportada** | Huella dactilar, Face ID, reconocimiento facial Android |
| **Almacenamiento** | Clave privada en el dispositivo (Secure Enclave / TEE) |
| **Servidor** | Solo almacena clave pública + credential ID |
| **Fallback** | PIN de 6 dígitos siempre disponible |

```
Flujo biométrico:
1. Usuario toca [Confirmar pago]
2. App/PWA invoca navigator.credentials.get()
3. Dispositivo solicita huella/face
4. Dispositivo firma el challenge con clave privada
5. Servidor verifica firma con clave pública almacenada
6. Transacción autorizada

Importante: La biometría NUNCA sale del dispositivo.
El servidor nunca ve la huella dactilar ni el rostro.
```

### 2.4 Autenticación por Sesión WhatsApp

La verificación del número telefónico se hereda de WhatsApp:

- WhatsApp ya verificó el número del usuario (SIM + OTP de Meta)
- WhatPay vincula el `wa_id` (WhatsApp ID) con la cuenta del usuario
- Para operaciones sensibles (pagos), se requiere PIN/biometría adicional
- La sesión de WhatsApp NO es suficiente por sí sola para autorizar pagos

---

## 3. Cifrado de Datos

### 3.1 En Tránsito

| Canal | Protocolo | Detalle |
|---|---|---|
| Usuario → API Gateway | TLS 1.3 | Certificados Google-managed |
| Microservicio → Microservicio | mTLS | Certificados internos rotados cada 30 días |
| API → Base de datos | TLS 1.2+ | Cloud SQL SSL enforced |
| API → WhatsApp Cloud API | HTTPS/TLS 1.3 | Certificados de Meta |
| API → Transbank | HTTPS/TLS 1.2+ | Certificados de Transbank |

### 3.2 En Reposo

| Dato | Método | Key Management |
|---|---|---|
| Datos generales (DB) | AES-256-GCM (Cloud SQL) | Google Cloud KMS |
| PIN de usuario | bcrypt (cost 12) | N/A (hash unidireccional) |
| RUT | AES-256 + HMAC para búsqueda | Cloud KMS, rotación anual |
| Cuenta bancaria | AES-256 | Cloud KMS, rotación anual |
| Datos de tarjeta | **NO almacenados** | Tokenización vía Transbank |
| Logs de transacciones | Cifrado de disco (Cloud Storage) | Google-managed keys |
| Backups | AES-256 | Customer-managed keys (CMEK) |

### 3.3 Gestión de Claves (Cloud KMS)

```
Jerarquía de claves:
├── Master Key (HSM-backed, Google Cloud KMS)
│   ├── Data Encryption Key - Usuarios (rotación: anual)
│   ├── Data Encryption Key - Transacciones (rotación: anual)
│   ├── Data Encryption Key - Cuentas bancarias (rotación: anual)
│   └── Signing Key - JWT tokens (rotación: trimestral)
```

---

## 4. Detección de Fraude (Cloud AI)

### 4.1 Modelo de Scoring en Tiempo Real

Cada transacción recibe un score de riesgo antes de ser procesada:

```
Señales de entrada:
├── Monto de la transacción
├── Hora del día / día de la semana
├── Frecuencia de transacciones (velocity)
├── Relación sender-receiver (primera vez / recurrente)
├── Geolocalización aproximada (IP-based)
├── Device fingerprint
├── Historial de transacciones del sender
├── Historial de transacciones del receiver
└── Patrones de comportamiento del usuario

Score de salida: 0.0 (seguro) → 1.0 (fraude)
├── 0.0 - 0.3: Aprobar automáticamente
├── 0.3 - 0.7: Aprobar con monitoreo + flag para revisión
├── 0.7 - 0.9: Requiere verificación adicional (OTP por SMS)
└── 0.9 - 1.0: Bloquear transacción + alertar al equipo

SLA: Scoring en < 200ms (P99)
```

### 4.2 Reglas de Negocio (complementan ML)

```
Reglas hard-coded (no ML):
├── Bloquear si > 10 transacciones en 5 minutos
├── Bloquear si monto > 2x el máximo histórico del usuario
├── Bloquear si usuario bloqueado por PIN fallido
├── Alerta si nuevo dispositivo + transacción > $100.000 CLP
├── Bloquear si destino está en lista negra interna
└── Bloquear si IP de país distinto a Chile (sin viaje registrado)
```

### 4.3 Monitoreo Continuo

- **Dashboard de fraude**: Métricas en tiempo real en Grafana
- **Alertas automáticas**: PagerDuty para scores > 0.9
- **Revisión manual**: Cola de transacciones flaggeadas para analista
- **Retroalimentación**: Falsos positivos alimentan el modelo ML

---

## 5. Seguridad de Infraestructura

### 5.1 Google Cloud Platform

| Control | Implementación |
|---|---|
| **Identidad** | Workload Identity para service accounts |
| **Red** | VPC con subnets privadas, Cloud NAT para egress |
| **Firewall** | Reglas de Cloud Armor + VPC Firewall |
| **Secrets** | Secret Manager (rotación automática) |
| **Acceso** | IAM con principio de menor privilegio |
| **Logging** | Cloud Audit Logs (inmutables, 1 año retención) |
| **Compliance** | GCP Chile region (southamerica-west1) |

### 5.2 Seguridad de Contenedores

```
Docker security:
├── Imágenes base distroless (Google)
├── Escaneo de vulnerabilidades (Artifact Registry)
├── No correr como root
├── Read-only filesystem
├── Resource limits (CPU, memory)
└── Network policies (Kubernetes)
```

---

## 6. Protocolo de Respuesta a Incidentes

### Clasificación de Severidad

| Nivel | Descripción | Tiempo de Respuesta | Ejemplo |
|---|---|---|---|
| **P1 - Crítico** | Brecha de datos / fraude masivo | 15 minutos | Acceso no autorizado a DB |
| **P2 - Alto** | Vulnerabilidad explotable | 1 hora | XSS en enlace de pago |
| **P3 - Medio** | Anomalía de seguridad | 4 horas | Spike de intentos de login fallidos |
| **P4 - Bajo** | Mejora de seguridad | 1 semana | Dependencia con CVE bajo |

### Procedimiento P1 (Crítico)

```
1. DETECTAR     → Alerta automática (Cloud Monitoring / SIEM)
2. CONTENER     → Aislar sistema afectado (kill switch disponible)
3. EVALUAR      → Determinar alcance y datos comprometidos
4. NOTIFICAR    → Equipo interno (15 min) → CMF (24 hrs) → Usuarios (72 hrs)
5. ERRADICAR    → Eliminar vector de ataque
6. RECUPERAR    → Restaurar servicio con parche
7. POST-MORTEM  → Análisis de causa raíz + mejoras (5 días hábiles)
```

---

## 7. Compliance y Auditoría

### PCI DSS

WhatPay aplica **PCI DSS SAQ-A** porque:
- **NO almacena** datos de tarjeta
- Tokenización delegada a Transbank (PCI DSS Level 1)
- Todas las páginas de pago con tarjeta son hosted por Transbank (WebPay)

### Auditorías Programadas

| Tipo | Frecuencia | Ejecutor |
|---|---|---|
| Pentesting externo | Trimestral | Empresa certificada (ej: Dreamlab) |
| Auditoría de código | Semestral | Revisión estática (SonarQube + manual) |
| Auditoría CMF | Anual | Auditor externo registrado |
| Simulacro de incidente | Semestral | Equipo interno |
| Revisión de accesos | Mensual | Equipo de seguridad |

### Logging y Trazabilidad

```
Todos los eventos de seguridad se registran en formato inmutable:

{
  "timestamp": "2026-02-25T14:32:00.000Z",
  "event_type": "payment.authorized",
  "user_id": "uuid-hash",
  "ip": "masked",
  "device_fingerprint": "hash",
  "transaction_id": "uuid",
  "fraud_score": 0.12,
  "auth_method": "pin",
  "result": "success"
}

Retención: 5 años (requisito UAF/CMF)
Almacenamiento: Cloud Storage (immutable bucket) + BigQuery (análisis)
```

---

## 8. Kill Switch (Interrupción de Emergencia)

En caso de compromiso grave, WhatPay tiene mecanismos de corte inmediato:

| Nivel | Acción | Activación |
|---|---|---|
| **Usuario** | Bloquear cuenta individual | Automático (fraude) o manual (soporte) |
| **Transacciones** | Pausar todas las transacciones | Manual (CTO/CEO) + automático si fraude > umbral |
| **Sistema** | Modo mantenimiento total | Manual (CTO) - requiere aprobación dual |

```typescript
// Kill switch implementación
interface KillSwitch {
  level: 'user' | 'transactions' | 'system';
  activatedBy: string;        // userId del operador
  requiredApprovals: number;  // 1 para user, 2 para system
  reason: string;
  activatedAt: Date;
  autoRevertAfter?: number;   // minutos (null = manual revert)
}
```
