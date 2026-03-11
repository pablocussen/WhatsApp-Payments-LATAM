# WhatPay — Tareas para Operación 100%

> Estado actual: Bot funcional en WhatsApp (número de prueba Meta), 1373+ tests,
> deployado en GCP Cloud Run (southamerica-west1). Token permanente configurado.

---

## CEO (Pablo)

### 1. WhatsApp Business — Número Chileno Propio
- [ ] Comprar SIM/número dedicado (+56 9 XXXX XXXX) solo para WhatPay
- [ ] En Meta Developer Console → "Agregar número de teléfono" → verificar por SMS
- [ ] Actualizar `WHATSAPP_PHONE_NUMBER_ID` en Cloud Run con el nuevo Phone Number ID
- [ ] Solicitar verificación de negocio en Meta Business Manager (badge verde ✓)
- **Dependencia**: Necesitas razón social chilena (persona natural con giro o SpA)
- **Tiempo estimado**: 1-3 semanas (verificación Meta)

### 2. Entidad Legal
- [ ] Constituir SpA o usar giro existente para operar como plataforma de pagos
- [ ] Obtener e-RUT actualizado del SII
- [ ] Abrir cuenta corriente empresa en banco chileno (Banco Estado, BCI, etc.)
- **Nota**: La cuenta bancaria es necesaria para recibir settlements de Khipu/Transbank

### 3. Regulatorio CMF / UAF
- [ ] Evaluar si WhatPay califica como Emisor de Dinero Electrónico (Ley 20.950)
- [ ] Consultar abogado fintech (recomendado: estudio especializado en CMF)
- [ ] Registrarse en la UAF (Unidad de Análisis Financiero) — obligatorio para movimiento de fondos
- [ ] Definir política de Prevención de Lavado de Activos (PLA)
- [ ] Implementar reporte de Operaciones Sospechosas (ROS) si aplica
- **Contacto sugerido**: CMF — www.cmfchile.cl / UAF — www.uaf.cl

### 4. Pasarelas de Pago — Credenciales Producción
- [ ] **Khipu**: Contactar comercial@khipu.com → cuenta de cobrador en producción
  - Entregar: RUT empresa, cuenta bancaria, datos de contacto
  - Obtener: `KHIPU_RECEIVER_ID` y `KHIPU_SECRET` de producción
- [ ] **Transbank**: Iniciar proceso de certificación en transbankdevelopers.cl
  - Proceso: solicitud → pruebas técnicas → certificación → credenciales producción
  - Obtener: `TRANSBANK_COMMERCE_CODE` y `TRANSBANK_API_KEY` de producción
  - Entregar: razón social, RUT, rubro, URL del sitio
- **Nota**: Khipu es más rápido (~1 semana). Transbank toma 2-4 semanas.

### 5. Base de Datos Producción
- [ ] Crear instancia Cloud SQL PostgreSQL en GCP (`whatpay-cl` project)
  - Región: `southamerica-west1` (Santiago)
  - Tier: `db-f1-micro` para empezar (~$10 USD/mes)
  - Habilitar backups automáticos diarios
- [ ] Configurar conexión privada (VPC connector) con Cloud Run
- [ ] Actualizar `DATABASE_URL` en Cloud Run
- [ ] Ejecutar `prisma migrate deploy` en la instancia de producción

### 6. Redis Producción
- [ ] Crear instancia Memorystore Redis en GCP
  - Región: `southamerica-west1`
  - Tier: Basic, 1GB (~$30 USD/mes)
- [ ] Configurar VPC connector compartido con Cloud SQL
- [ ] Actualizar `REDIS_URL` en Cloud Run

### 7. Dominio y DNS
- [ ] Registrar `whatpay.cl` (o similar) en NIC Chile
- [ ] Configurar DNS para `api.whatpay.cl` → Cloud Run (custom domain mapping)
- [ ] Habilitar SSL/TLS (automático con Cloud Run custom domains)
- [ ] Actualizar `APP_BASE_URL` y `PAYMENT_LINK_BASE_URL` en Cloud Run

### 8. Seguridad — Variables de Entorno
- [ ] Setear `WHATSAPP_APP_SECRET` en Cloud Run (App Secret de Meta Developer Console)
  - Esto activa la validación HMAC de webhooks (el código ya lo soporta)
- [ ] Generar `ADMIN_API_KEY` (32+ chars aleatorios) para acceso al panel admin
- [ ] Verificar que `ENCRYPTION_KEY_HEX` esté en Secret Manager (ya configurado)
- [ ] Generar `JWT_SECRET` de producción (32+ chars aleatorios, diferente al de staging)

### 9. Monitoreo
- [ ] Configurar alertas en Cloud Monitoring:
  - Error rate > 5% en 5 minutos
  - Latency p99 > 5 segundos
  - Container restart count > 3 en 1 hora
- [ ] Configurar uptime check en `https://api.whatpay.cl/health`
- [ ] Canal de notificación: email + WhatsApp (al número del CEO)

---

## Gerente de Operaciones

### 10. Legal — Documentos de Usuario
- [ ] Redactar Términos y Condiciones de uso
  - Incluir: límites de responsabilidad, comisiones, política de reembolso (72h)
  - Referencia: Ley 19.496 (Protección al consumidor) + Ley 20.950
- [ ] Redactar Política de Privacidad
  - LGPD Chile (en trámite) + mejores prácticas GDPR
  - Detallar: qué datos se almacenan (RUT encriptado, PIN hasheado), retención, derechos ARCO
- [ ] Implementar aceptación de T&C durante registro bot
  - Flujo: antes de pedir RUT, enviar link a T&C con botón "Acepto"
- [ ] Política de cookies / datos para la landing page

### 11. KYC — Proveedor de Verificación de Identidad
- [ ] Evaluar proveedores:
  - **Metamap** (ex-Mati) — verificación por selfie + cédula, API, ~$1-2 USD/verificación
  - **Truora** — verificación LATAM, background checks, ~$0.5-1 USD
  - **TOC Biometrics** — chileno, integración con Registro Civil
- [ ] Seleccionar proveedor y firmar contrato
- [ ] Coordinar integración API con equipo técnico (el flujo KYC_CONFIRM ya existe)

### 12. Atención al Cliente
- [ ] Crear email soporte@whatpay.cl (ya referenciado en el bot)
- [ ] Definir SLA: respuesta < 24h en días hábiles
- [ ] Preparar FAQ / respuestas predefinidas para consultas comunes:
  - "¿Cómo recargo saldo?"
  - "Mi pago no llegó"
  - "Olvidé mi PIN" (requiere soporte manual: reset desde admin)
  - "Quiero cerrar mi cuenta"
- [ ] Evaluar herramienta de ticketing (Freshdesk free / Zendesk / simple email)

### 13. Comunicación y Marketing
- [ ] Activar formulario waitlist en landing page (Formspree o similar)
- [ ] Preparar mensaje de lanzamiento para early adopters
- [ ] Definir plan de onboarding:
  - Invitar primeros 50 usuarios (amigos/conocidos) como beta cerrada
  - Monitorear DLQ y logs en los primeros días
  - Iterar según feedback real
- [ ] Preparar contenido para redes sociales (Instagram, LinkedIn)

### 14. Comisiones y Pricing
- [ ] Definir estructura de comisiones final:
  - P2P entre wallets: gratis (actual: $0)
  - Recarga WebPay crédito: 2.8% + $50 (actual)
  - Recarga WebPay débito: 1.8% + $50 (actual)
  - Recarga Khipu: 1.0% (actual)
  - Cobros/Payment Links: ¿comisión al comercio?
- [ ] Validar que las comisiones sean competitivas vs Mercado Pago, MACH, Tenpo
- [ ] Documentar en T&C

### 15. Testing Pre-Lanzamiento
- [ ] Prueba end-to-end completa con dinero real (Khipu integración):
  - Crear cuenta → recargar → enviar pago → recibir → devolver
- [ ] Prueba con 5-10 usuarios reales en beta cerrada
- [ ] Verificar todos los flujos del bot con el número chileno real
- [ ] Load test: simular 100 mensajes concurrentes (k6 o artillery)

---

## Prioridad de Ejecución

| # | Tarea | Responsable | Prioridad | Bloqueante |
|---|-------|-------------|-----------|------------|
| 1 | Entidad legal (SpA) | CEO | CRÍTICA | Bloquea 3, 4, 7 |
| 2 | Cuenta bancaria empresa | CEO | CRÍTICA | Bloquea 4 |
| 3 | Registro CMF/UAF | CEO | CRÍTICA | Bloquea lanzamiento |
| 4 | Khipu producción | CEO | ALTA | Bloquea pagos reales |
| 5 | Cloud SQL + Redis | CEO | ALTA | Bloquea persistencia |
| 6 | Número WhatsApp chileno | CEO | ALTA | Bloquea UX |
| 7 | Dominio whatpay.cl | CEO | MEDIA | Branding |
| 8 | T&C + Privacidad | Gerente | ALTA | Bloquea lanzamiento |
| 9 | Proveedor KYC | Gerente | MEDIA | Bloquea INTERMEDIATE+ |
| 10 | Soporte (email + FAQ) | Gerente | MEDIA | UX post-launch |
| 11 | Transbank producción | CEO | MEDIA | Solo agrega WebPay |
| 12 | Variables seguridad | CEO | ALTA | 5 min cada una |
| 13 | Monitoreo/alertas | CEO | MEDIA | Operación estable |
| 14 | Waitlist + marketing | Gerente | BAJA | Growth |
| 15 | Beta cerrada (5-10 users) | Ambos | ALTA | Validación final |

---

## Costo Mensual Estimado (Mínimo Viable)

| Servicio | Costo USD/mes |
|----------|--------------|
| Cloud Run (bajo tráfico) | ~$5 |
| Cloud SQL (db-f1-micro) | ~$10 |
| Memorystore Redis (1GB) | ~$30 |
| Dominio .cl (anual/12) | ~$2 |
| WhatsApp Business API | Gratis (primeras 1000 conv/mes) |
| Khipu comisiones | Variable (1% de volumen) |
| **Total infraestructura** | **~$47/mes** |

> Las conversaciones de WhatsApp Business son gratis las primeras 1,000/mes en la categoría
> "service" (respuestas a mensajes del usuario). Después: ~$0.04 USD/conversación en Chile.
