# 06 - Cronograma de Desarrollo y Plan de Pruebas

## Cronograma General: 6 Meses al MVP

### Equipo Mínimo Requerido

| Rol | Cantidad | Responsabilidad |
|---|---|---|
| Tech Lead / Arquitecto | 1 | Arquitectura, decisiones técnicas, code review |
| Backend Developer (Senior) | 2 | Microservicios, integraciones de pago, API |
| Frontend Developer | 1 | PWA dashboard comercios, landing pages |
| ML Engineer (medio tiempo) | 1 | Modelo de fraude con Cloud AI |
| DevOps / SRE | 1 | Infraestructura GCP, CI/CD, monitoreo |
| Product / UX | 1 | Diseño de flujos, testing de usabilidad |
| QA Engineer | 1 | Testing automatizado e integración |
| **Total** | **8** | |

---

## Fase 1: Fundamentos (Semanas 1-4)

### Semana 1-2: Setup y Arquitectura

| Tarea | Responsable | Entregable |
|---|---|---|
| Setup repositorio + monorepo structure | Tech Lead | Repo configurado con linting, CI base |
| Configurar GCP proyecto + IAM | DevOps | Proyecto GCP con ambientes dev/staging |
| Setup Docker Compose local | DevOps | docker-compose.yml funcional |
| Diseño de esquema de base de datos | Backend Sr. | Migrations PostgreSQL listas |
| Configurar Antigravity framework | Tech Lead | Framework inicializado con servicios base |
| Configurar WhatsApp Business API | Backend Sr. | Cuenta verificada, webhook recibiendo |
| Wireframes de flujos principales | UX | Flujos aprobados por stakeholders |

### Semana 3-4: Core Services v0

| Tarea | Responsable | Entregable |
|---|---|---|
| User Service: registro + autenticación | Backend 1 | Registro por WhatsApp funcional |
| WhatsApp Service: webhooks + mensajes | Backend 2 | Bot responde mensajes básicos |
| Payment Service: modelo de transacción | Backend 1 | CRUD de transacciones |
| Setup Cloud SQL + Redis | DevOps | Bases de datos en staging |
| Diseño de mensajes interactivos WhatsApp | UX | Templates de mensajes aprobados |
| Setup CI/CD pipeline (Cloud Build) | DevOps | Deploy automático a staging |
| Tests unitarios: User Service | QA | > 80% coverage User Service |

**Hito Fase 1**: Bot de WhatsApp responde, usuarios se pueden registrar con RUT + PIN.

---

## Fase 2: Pagos Core (Semanas 5-8)

### Semana 5-6: Motor de Pagos

| Tarea | Responsable | Entregable |
|---|---|---|
| Wallet Service: saldo + movimientos | Backend 1 | Wallet con recarga y consulta |
| Integración Transbank WebPay Plus | Backend 2 | Recarga con tarjeta funcional |
| Integración Khipu | Backend 2 | Recarga por transferencia funcional |
| Flujo P2P wallet-to-wallet | Backend 1 | Envío de dinero entre usuarios |
| Autenticación PIN para pagos | Backend 1 | PIN requerido en cada transacción |
| Antigravity: Saga de pago completa | Tech Lead | Flujo con compensación |
| Tests integración: flujo de pago | QA | Tests e2e del flujo P2P |

### Semana 7-8: Enlaces de Pago + Notificaciones

| Tarea | Responsable | Entregable |
|---|---|---|
| Payment Links: generación + resolución | Backend 1 | Enlace compartible que acepta pagos |
| Landing page de enlace de pago | Frontend | PWA con opciones de pago |
| Notification Service | Backend 2 | Confirmaciones por WhatsApp automáticas |
| Templates de WhatsApp (aprobación Meta) | UX + Backend | Templates aprobados por Meta |
| Retiro a cuenta bancaria | Backend 1 | Flujo de retiro funcional |
| Setup monitoring (Grafana + alertas) | DevOps | Dashboard operacional |
| Tests integración: enlaces de pago | QA | Tests e2e enlaces + pago |

**Hito Fase 2**: Usuarios pueden recargar wallet, enviar pagos P2P, y pagar con enlace compartible.

---

## Fase 3: Seguridad y Comercios (Semanas 9-12)

### Semana 9-10: Seguridad Avanzada

| Tarea | Responsable | Entregable |
|---|---|---|
| Fraud Detector v1 (reglas) | Backend 2 | Reglas de velocidad y montos |
| Cloud AI: modelo de fraude ML | ML Engineer | Modelo entrenado con datos sintéticos |
| WebAuthn: autenticación biométrica | Backend 1 | Biometría como alternativa a PIN |
| KYC nivel intermedio (cédula + selfie) | Backend 1 | Verificación de identidad |
| Rate limiting + abuse prevention | DevOps | Cloud Armor configurado |
| Pentesting interno | QA + Tech Lead | Reporte de vulnerabilidades |
| Cifrado de datos sensibles (KMS) | DevOps | Datos cifrados en reposo |

### Semana 11-12: Dashboard Comercios

| Tarea | Responsable | Entregable |
|---|---|---|
| Merchant Service: registro de comercios | Backend 2 | Onboarding de comercios |
| Dashboard web: ventas y transacciones | Frontend | PWA con métricas básicas |
| Generador de QR + enlaces | Frontend | QR descargable + enlace personalizado |
| Liquidación a comercios (Settlement) | Backend 1 | Proceso batch T+1 |
| Reportes de liquidación | Backend 2 | Reporte descargable CSV/PDF |
| Tests e2e flujo completo comercio | QA | Cobertura completa merchant |

**Hito Fase 3**: Sistema seguro con detección de fraude, biometría disponible,
comercios pueden registrarse y cobrar.

---

## Fase 4: Polish y MVP Launch (Semanas 13-18)

### Semana 13-14: Estabilización

| Tarea | Responsable | Entregable |
|---|---|---|
| Load testing (k6 / Artillery) | QA + DevOps | Sistema soporta 500 TPS |
| Fix de bugs de integración | Todo el equipo | 0 bugs P1/P2 abiertos |
| Optimización de latencia | Tech Lead | API response < 500ms P95 |
| Disaster recovery drill | DevOps | DR documentado y probado |
| Revisión de seguridad final | Externo | Pentesting por firma externa |

### Semana 15-16: Beta Cerrada

| Tarea | Responsable | Entregable |
|---|---|---|
| Onboarding 50 beta testers | Product | Feedback recopilado |
| Onboarding 10 comercios beta | Product | Comercios usando el sistema |
| Ajustes UX basados en feedback | UX + Frontend | Iteraciones implementadas |
| Monitoreo intensivo | DevOps | SLA 99.9% durante beta |
| A/B testing mensajes WhatsApp | Product | Mensajes optimizados |

### Semana 17-18: Lanzamiento MVP

| Tarea | Responsable | Entregable |
|---|---|---|
| Lanzamiento público (soft launch) | Todo el equipo | App en producción |
| Campaña de referidos activa | Product | Programa "invita y gana" |
| Soporte al cliente 24/7 setup | Operaciones | Equipo de soporte listo |
| Monitoring 24/7 primera semana | DevOps | Turnos de guardia |
| Post-launch retrospective | Todo el equipo | Learnings documentados |

**Hito Fase 4**: MVP público en producción con usuarios reales transaccionando.

---

## Plan de Pruebas

### Estrategia de Testing

```
Pirámide de testing:
                    ┌─────┐
                    │ E2E │  10% - Flujos críticos completos
                   ┌┴─────┴┐
                   │ Integ. │  30% - Integración entre servicios
                  ┌┴───────┴┐
                  │ Unitarios │  60% - Lógica de negocio aislada
                  └──────────┘
```

### Tests Unitarios

| Módulo | Cobertura Mínima | Herramienta |
|---|---|---|
| User Service | 85% | Jest + ts-jest |
| Payment Service | 90% | Jest + ts-jest |
| WhatsApp Service | 80% | Jest + mocks |
| Fraud Detector | 90% | pytest + pytest-cov |
| Utility functions | 95% | Jest |

```typescript
// Ejemplo: Test unitario de validación de PIN
describe('PIN Validation', () => {
  it('should reject PINs shorter than 6 digits', () => {
    expect(isSecurePin('12345')).toBe(false);
  });

  it('should reject sequential PINs', () => {
    expect(isSecurePin('123456')).toBe(false);
    expect(isSecurePin('654321')).toBe(false);
  });

  it('should reject repeated digit PINs', () => {
    expect(isSecurePin('111111')).toBe(false);
    expect(isSecurePin('999999')).toBe(false);
  });

  it('should accept valid PINs', () => {
    expect(isSecurePin('483921')).toBe(true);
    expect(isSecurePin('719203')).toBe(true);
  });
});
```

### Tests de Integración

| Flujo | Servicios Involucrados | Herramienta |
|---|---|---|
| Registro de usuario | WhatsApp + User + DB | Supertest + TestContainers |
| Pago P2P completo | WhatsApp + Payment + Wallet + Notification | Supertest + TestContainers |
| Recarga con Transbank | Payment + Transbank Mock + Wallet | Supertest + WireMock |
| Enlace de pago | Merchant + Payment + WhatsApp | Supertest + Playwright |
| Detección de fraude | Payment + Fraud Detector + Cloud AI | pytest + mocks |

### Tests End-to-End (E2E)

| Escenario | Descripción | Herramienta |
|---|---|---|
| Happy path P2P | Registro → Recarga → Pago → Confirmación | Playwright + WhatsApp Sandbox |
| Happy path comercio | Registro comercio → Enlace → Cliente paga → Liquidación | Playwright |
| Fraude bloqueado | 10 transacciones rápidas → Bloqueo automático | Script automatizado |
| Recuperación de PIN | PIN olvidado → Verificación → Nuevo PIN | Playwright |
| Error handling | Timeout de Transbank → Reversa → Notificación | Chaos testing |

### Tests de Carga (Performance)

```yaml
# k6 load test configuration
scenarios:
  payment_flow:
    executor: ramping-vus
    startVUs: 10
    stages:
      - duration: 2m
        target: 100    # Ramp up
      - duration: 5m
        target: 500    # Peak load
      - duration: 2m
        target: 0      # Ramp down

thresholds:
  http_req_duration:
    - p(95) < 500      # 95% de requests en < 500ms
    - p(99) < 1000     # 99% de requests en < 1s
  http_req_failed:
    - rate < 0.01      # < 1% de errores
```

### Tests de Seguridad

| Tipo | Frecuencia | Herramienta | Responsable |
|---|---|---|---|
| SAST (código estático) | Cada PR | SonarQube + Semgrep | CI automático |
| DAST (dinámico) | Semanal | OWASP ZAP | QA |
| Dependency scanning | Diario | Snyk / Dependabot | CI automático |
| Container scanning | Cada build | Google Artifact Analysis | CI automático |
| Pentesting manual | Trimestral | Firma externa | Externo |

### Ambientes de Testing

| Ambiente | Datos | Integraciones | Propósito |
|---|---|---|---|
| **Local** | Seed data fijo | Mocks de todo | Desarrollo rápido |
| **CI** | Generados por tests | TestContainers + mocks | Validación automática |
| **Staging** | Datos sintéticos realistas | WhatsApp Sandbox + Transbank test | Integración real |
| **Pre-prod** | Copia anonimizada de prod | APIs reales (modo test) | Validación final |

---

## Herramientas de Desarrollo

### Stack de Desarrollo

| Categoría | Herramienta |
|---|---|
| **Lenguaje principal** | TypeScript 5.x (Node.js 20 LTS) |
| **Lenguaje ML** | Python 3.11+ |
| **Framework API** | Express.js + Zod (validación) |
| **Framework ML** | FastAPI |
| **ORM** | Prisma (PostgreSQL) |
| **Testing** | Jest, Supertest, Playwright, pytest, k6 |
| **CI/CD** | Google Cloud Build + GitHub Actions |
| **Contenedores** | Docker + Cloud Run |
| **IaC** | Terraform (GCP) |
| **Monitoreo** | Cloud Monitoring, Grafana, PagerDuty |
| **Logging** | Cloud Logging + structured JSON logs |
| **Code Quality** | ESLint, Prettier, SonarQube, Semgrep |
| **Documentación** | Markdown + ADRs + OpenAPI/Swagger |
| **Gestión proyecto** | Linear o GitHub Projects |
| **Comunicación** | Slack + Confluence |

### CI/CD Pipeline

```
Push to main:
├── Lint + Format check
├── Unit tests (parallel)
├── Build Docker images
├── Container vulnerability scan
├── Integration tests (TestContainers)
├── Deploy to staging (auto)
├── E2E tests on staging
├── Manual approval gate
└── Deploy to production (blue-green)

Push to feature branch:
├── Lint + Format check
├── Unit tests
├── Build check
└── PR preview deploy (optional)
```

---

## Criterios de Éxito del MVP

| Criterio | Métrica | Umbral |
|---|---|---|
| **Funcionalidad** | Flujos core operativos | 100% (registro, P2P, enlace, recarga, retiro) |
| **Estabilidad** | Uptime en primera semana | > 99.5% |
| **Performance** | Latencia API P95 | < 500ms |
| **Seguridad** | Vulnerabilidades críticas | 0 (pentesting limpio) |
| **UX** | Tasa de completación de pago | > 85% |
| **Adopción** | Usuarios registrados semana 1 | > 100 |
| **Transacciones** | Pagos exitosos semana 1 | > 500 |

---

## Riesgos Técnicos y Mitigación

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Aprobación de templates WhatsApp demora | Bloquea UX | Solicitar templates en semana 1 |
| Integración Transbank compleja | Demora en pagos con tarjeta | Empezar con Khipu (más simple) |
| Modelo de fraude con falsos positivos altos | Mala experiencia usuario | Reglas simples primero, ML después |
| Latencia de Cloud AI | Timeout en scoring | Timeout de 200ms, fallback a reglas |
| Cambios en WhatsApp Business API | Rompe integraciones | Capa de abstracción, versionamiento |
