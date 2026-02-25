# 02 - Marco Legal y Regulatorio - Chile

## Resumen Ejecutivo

Chile cuenta con uno de los marcos regulatorios fintech más avanzados de Latinoamérica.
La Ley 21.521 (Ley Fintech, vigente desde febrero 2023) establece reglas claras para
servicios financieros tecnológicos, incluyendo plataformas de pago. WhatPay debe
cumplir con esta ley y las regulaciones de la CMF para operar legalmente.

---

## 1. Ley Fintech 21.521

### Alcance para WhatPay

WhatPay califica como **"Sistema Alternativo de Transacción"** según la Ley 21.521,
específicamente en la categoría de servicios de pago.

### Requisitos de Registro

| Requisito | Detalle | Estado |
|---|---|---|
| **Inscripción en CMF** | Registro como proveedor de servicios financieros | Obligatorio |
| **Capital mínimo** | UF 2.000 (~USD 80.000) para operadores de pago | Obligatorio |
| **Garantía operacional** | Póliza de seguro o boleta de garantía | Obligatorio |
| **Representante legal** | Persona natural con domicilio en Chile | Obligatorio |
| **Sociedad chilena** | SpA o SA constituida en Chile | Obligatorio |

### Obligaciones Permanentes

1. **Reporte periódico a CMF**: Estados financieros trimestrales
2. **Auditoría externa**: Auditoría anual por firma registrada en CMF
3. **Plan de continuidad**: Business Continuity Plan actualizado
4. **Gestión de riesgos**: Framework de gestión de riesgos operacionales
5. **Protección de fondos**: Segregación de fondos de clientes en cuenta fiduciaria

---

## 2. Prevención de Lavado de Activos (PLA/KYC/AML)

### Ley 19.913 - Unidad de Análisis Financiero (UAF)

WhatPay debe registrarse como sujeto obligado ante la UAF y cumplir:

### Niveles de KYC (Know Your Customer)

| Nivel | Verificación | Límites Mensuales | Uso |
|---|---|---|---|
| **Básico** | Nombre + RUT + Teléfono | Hasta $200.000 CLP (~USD 220) | Pagos P2P pequeños |
| **Intermedio** | + Selfie + Cédula de identidad | Hasta $2.000.000 CLP (~USD 2.200) | Uso regular |
| **Completo** | + Comprobante domicilio + Origen fondos | Sin límite* | Comercios y alto volumen |

*Sujeto a monitoreo continuo de transacciones.

### Obligaciones AML

- **Reporte de Operaciones Sospechosas (ROS)**: A la UAF dentro de 24 horas
- **Registro de operaciones**: Mantener registros por mínimo 5 años
- **Umbral de reporte automático**: Transacciones > UF 450 (~USD 18.000)
- **Oficial de cumplimiento**: Designar un oficial de cumplimiento PLA
- **Capacitación**: Programa anual de capacitación AML para el equipo

### Implementación Técnica KYC

```
Flujo de verificación KYC Nivel Intermedio:
1. Usuario proporciona RUT → Validación formato + dígito verificador
2. Foto de cédula de identidad (frente y reverso)
3. Selfie con detección de vida (liveness detection)
4. Verificación cruzada con SII (Servicio de Impuestos Internos)
5. Verificación en listas PEP (Personas Expuestas Políticamente)
6. Verificación en listas OFAC/UN de sanciones internacionales
```

---

## 3. Protección de Datos Personales

### Ley 19.628 (actual) + Reforma en trámite

Chile está en proceso de actualizar su ley de datos personales. WhatPay debe
cumplir con la ley actual y prepararse para la nueva regulación (alineada con GDPR).

### Obligaciones

| Obligación | Implementación en WhatPay |
|---|---|
| **Consentimiento** | Opt-in explícito al registrarse, granular por tipo de dato |
| **Finalidad** | Datos usados solo para procesar pagos y cumplimiento regulatorio |
| **Seguridad** | Cifrado en tránsito (TLS 1.3) y en reposo (AES-256) |
| **Derecho de acceso** | API de exportación de datos del usuario |
| **Derecho de eliminación** | Proceso de eliminación (con retención regulatoria de 5 años) |
| **Breach notification** | Notificación a autoridad y usuarios en < 72 horas |

### Datos Sensibles

```
Datos que manejamos:
├── RUT (identificador tributario) → Cifrado, hash para búsqueda
├── Número de teléfono → Cifrado, vinculado a identidad
├── Datos de tarjeta → NUNCA almacenados (tokenización vía Transbank)
├── Cuenta bancaria → Cifrado AES-256, acceso restringido
├── Historial transacciones → Cifrado, retención 5 años (regulatorio)
├── Geolocalización → Solo para detección de fraude, no almacenada
└── Biometría → Procesada en dispositivo, nunca en servidor
```

---

## 4. Regulación de Pagos

### Compendio de Normas CMF - Capítulo 8-4

Para operar como emisor de medios de pago:

- **Requisito**: Registro ante CMF como emisor/operador de medios de pago
- **Fondos**: Los fondos de usuarios deben estar segregados en cuenta fiduciaria
  en banco regulado por CMF
- **Liquidación**: Plazos máximos de liquidación a comercios según normativa
- **Transparencia**: Publicación de tarifas y comisiones de forma clara

### Límites de Transacción (propuestos para WhatPay)

| Tipo | Mínimo | Máximo por Tx | Máximo Mensual |
|---|---|---|---|
| P2P (KYC Básico) | $100 CLP | $50.000 CLP | $200.000 CLP |
| P2P (KYC Intermedio) | $100 CLP | $500.000 CLP | $2.000.000 CLP |
| Pago a Comercio | $100 CLP | $2.000.000 CLP | Sin límite* |
| Recarga wallet | $1.000 CLP | $500.000 CLP | $2.000.000 CLP |

*Sujeto a verificación KYC completa del comercio.

---

## 5. Ley de Protección al Consumidor (Ley 19.496 / SERNAC)

### Obligaciones con usuarios

- **Información clara**: Comisiones, plazos y condiciones en lenguaje simple
- **Derecho a retracto**: 10 días hábiles para compras a distancia
- **Resolución de disputas**: Proceso interno de reclamos + SERNAC
- **Términos y condiciones**: Disponibles antes del registro, modificables con aviso previo de 30 días
- **Comprobante**: Envío automático de comprobante digital por cada transacción

---

## 6. Facturación Electrónica (SII)

### Boleta/Factura Electrónica

Los comercios que usen WhatPay deben cumplir con la normativa del SII:

- **Boleta electrónica**: Para ventas a consumidor final
- **Factura electrónica**: Para ventas entre empresas
- **Integración**: WhatPay puede ofrecer integración con DTEs (Documentos Tributarios Electrónicos)
  via API del SII o servicios como Bsale/Nubox

---

## 7. Estructura Societaria Recomendada

```
WhatPay SpA (Chile)
├── Registro CMF como operador de pagos
├── Registro UAF como sujeto obligado
├── Cuenta fiduciaria en banco regulado (BCI / Santander / BancoEstado)
├── Póliza de seguro de responsabilidad civil
└── Contrato con Transbank como comercio afiliado
```

### Costos Estimados de Constitución y Compliance

| Concepto | Costo Estimado |
|---|---|
| Constitución SpA | $200.000 CLP (~USD 220) |
| Capital mínimo (UF 2.000) | ~$75.000.000 CLP (~USD 82.000) |
| Abogado fintech (setup regulatorio) | $5.000.000 - $10.000.000 CLP |
| Auditoría anual | $3.000.000 - $6.000.000 CLP |
| Oficial de cumplimiento (anual) | $18.000.000 - $30.000.000 CLP |
| Seguro de responsabilidad civil | $2.000.000 - $4.000.000 CLP/año |

**Inversión inicial estimada (legal + compliance)**: ~USD 120.000 - 180.000

---

## 8. Riesgos Legales y Mitigación

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Rechazo de registro CMF | Media | Crítico | Asesoría legal especializada desde el inicio |
| Incumplimiento AML | Baja | Crítico | Sistema automatizado + oficial de cumplimiento |
| Brecha de datos | Baja | Alto | Cifrado end-to-end, pentesting trimestral |
| Cambio regulatorio | Media | Medio | Monitoreo regulatorio activo, diseño flexible |
| Disputa con Meta/WhatsApp | Baja | Alto | Diversificación canales (Telegram, SMS fallback) |

---

## 9. Timeline de Compliance

| Mes | Hito Legal |
|---|---|
| 1-2 | Constitución SpA + designación representante legal |
| 2-3 | Contratación asesoría legal fintech |
| 3-4 | Preparación documentación CMF |
| 4-6 | Solicitud de registro ante CMF |
| 5-6 | Registro ante UAF como sujeto obligado |
| 6-8 | Apertura cuenta fiduciaria en banco |
| 7-8 | Contratación oficial de cumplimiento |
| 8-10 | Proceso de aprobación CMF (estimado) |
| 10-12 | Obtención de licencia + inicio de operaciones |

> **Nota**: El proceso de aprobación CMF puede tomar 3-6 meses adicionales
> dependiendo de la completitud de la documentación y la carga del regulador.

---

## 10. Fuentes y Referencias

- Ley 21.521 - Ley Fintech Chile (Biblioteca del Congreso Nacional)
- Compendio de Normas CMF, Capítulo 8-4
- Ley 19.913 - Unidad de Análisis Financiero
- Ley 19.628 - Protección de Datos Personales
- Ley 19.496 - Protección del Consumidor (SERNAC)
- Normativa SII sobre facturación electrónica
- WhatsApp Business Policy - Commerce Policy
