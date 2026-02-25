# 04 - Modelo de Negocio e Ingresos

## Modelo de Ingresos: Comisión por Transacción

WhatPay genera ingresos principalmente a través de comisiones sobre transacciones
procesadas. El modelo es diseñado para ser competitivo frente a alternativas existentes
en Chile (MercadoPago, Flow.cl, Transbank directo).

---

## 1. Estructura de Comisiones

### Tabla de Comisiones

| Tipo de Transacción | Comisión WhatPay | Quién Paga | Comparación Mercado |
|---|---|---|---|
| **P2P (wallet a wallet)** | Gratis | N/A | MercadoPago: gratis |
| **Pago a comercio (wallet)** | 1.5% | Comercio | Flow: 2.49% |
| **Pago con tarjeta crédito** | 2.8% + $50 CLP | Comercio | Transbank: 2.49-3.49% |
| **Pago con tarjeta débito** | 1.8% + $50 CLP | Comercio | Transbank: 1.49% |
| **Pago con Khipu (banco)** | 1.0% | Comercio | Khipu directo: 1.2% |
| **Retiro a cuenta bancaria** | $300 CLP fijo | Usuario | MercadoPago: gratis (T+20) |
| **Retiro express (< 2hrs)** | $500 CLP fijo | Usuario | No disponible en competencia |

### Comisiones por Volumen (Comercios Premium)

| Volumen Mensual | Descuento |
|---|---|
| < $1.000.000 CLP | Tarifa estándar |
| $1.000.000 - $5.000.000 CLP | -0.2% |
| $5.000.000 - $20.000.000 CLP | -0.4% |
| > $20.000.000 CLP | Negociable |

---

## 2. Fuentes de Ingreso Secundarias

### 2.1 Float de Wallet (Ingreso Financiero)

Los fondos en wallets de usuarios generan rentabilidad mientras están depositados:

- **Depósito en fondo money market**: Rendimiento estimado 5-7% anual (TPM Chile ~5%)
- **Volumen estimado en wallets**: $500M CLP promedio (en estado estable)
- **Ingreso estimado**: $25-35M CLP/año

### 2.2 Servicios Premium para Comercios

| Servicio | Precio Mensual | Incluye |
|---|---|---|
| **Plan Básico** | Gratis | Cobros, enlace de pago, historial |
| **Plan Pro** | $19.990 CLP/mes | + Dashboard analytics, multi-usuario, API |
| **Plan Business** | $49.990 CLP/mes | + Integración e-commerce, webhooks, soporte prioritario |

### 2.3 Servicios de Valor Agregado (futuro)

- **Adelanto de liquidación**: Comercios reciben fondos al instante (comisión 2%)
- **Créditos express**: Microcréditos basados en historial transaccional (en alianza con fintech)
- **Seguros transaccionales**: Protección de compras (en alianza con aseguradoras)

---

## 3. Estructura de Costos

### Costos Variables (por transacción)

| Concepto | Costo |
|---|---|
| WhatsApp Business API (conversaciones) | ~$0.04 USD por conversación/24hrs |
| Transbank (tarjeta crédito) | 1.8% - 2.0% |
| Transbank (tarjeta débito) | 0.8% - 1.0% |
| Khipu (transferencia) | 0.8% |
| Cloud AI (fraude detection) | ~$0.002 USD por scoring |
| Infraestructura GCP (variable) | ~$0.001 USD por transacción |

### Costos Fijos Mensuales

| Concepto | Costo Mensual Estimado |
|---|---|
| Infraestructura GCP (base) | $2.000 USD |
| WhatsApp Business API (verificación) | $1.000 USD |
| Equipo técnico (4 ingenieros) | $12.000 USD |
| Equipo operaciones (2 personas) | $4.000 USD |
| Compliance y legal | $2.000 USD |
| Oficina y administrativos | $1.500 USD |
| Marketing y adquisición | $3.000 USD |
| **Total fijo mensual** | **~$25.500 USD** |

---

## 4. Proyecciones Financieras (Chile - Primeros 24 Meses)

### Supuestos Base

- Usuarios activos mensuales (MAU) crecen 20% mensual los primeros 12 meses
- Ticket promedio: $12.000 CLP
- Transacciones promedio por usuario activo: 8/mes
- Mix de pagos: 40% P2P (gratis), 35% wallet a comercio, 15% tarjeta, 10% Khipu

### Proyección de Usuarios y Transacciones

| Mes | MAU | Tx Mensuales | Volumen Procesado (CLP) |
|---|---|---|---|
| 3 | 500 | 2.000 | $24M |
| 6 | 3.000 | 15.000 | $180M |
| 9 | 10.000 | 60.000 | $720M |
| 12 | 25.000 | 150.000 | $1.800M |
| 18 | 60.000 | 400.000 | $4.800M |
| 24 | 120.000 | 800.000 | $9.600M |

### Proyección de Ingresos

| Mes | Ingreso Bruto (CLP) | Costo Procesamiento | Ingreso Neto (CLP) |
|---|---|---|---|
| 6 | $2.7M | $1.6M | $1.1M |
| 12 | $27M | $14M | $13M |
| 18 | $72M | $36M | $36M |
| 24 | $144M | $67M | $77M |

### Break-Even Estimado

- **Costos fijos mensuales**: ~$20M CLP (~$25.500 USD)
- **Margen neto por transacción cobrada**: ~$90 CLP promedio
- **Transacciones para break-even**: ~220.000/mes
- **Estimación break-even**: **Mes 10-12**

---

## 5. Métricas Clave (KPIs)

| KPI | Definición | Objetivo Mes 12 |
|---|---|---|
| **MAU** | Usuarios activos mensuales | 25.000 |
| **TPV** | Total Payment Volume mensual | $1.800M CLP |
| **Take Rate** | Ingreso / Volumen procesado | 1.5% |
| **CAC** | Costo adquisición por usuario | < $3.000 CLP |
| **LTV** | Lifetime value por usuario (12 meses) | > $15.000 CLP |
| **LTV/CAC** | Ratio | > 5x |
| **Churn** | Tasa de abandono mensual | < 5% |
| **NPS** | Net Promoter Score | > 50 |

---

## 6. Estrategia de Adquisición de Usuarios

### Fase 1: Tracción Inicial (Meses 1-6)

| Canal | Estrategia | CAC Estimado |
|---|---|---|
| Referidos P2P | "Invita un amigo, ambos ganan $2.000" | $2.000 CLP |
| Ferias y comercio local | Onboarding presencial en ferias libres | $1.500 CLP |
| Instagram/TikTok | Contenido educativo sobre pagos fáciles | $3.000 CLP |
| WhatsApp viral | Enlaces de pago compartidos traen usuarios nuevos | $500 CLP |

### Fase 2: Crecimiento (Meses 7-12)

| Canal | Estrategia |
|---|---|
| Partnerships | Alianzas con delivery apps, e-commerce locales |
| Comercios ancla | Convenios con cadenas de comercio que atraen usuarios |
| PR / Medios | Cobertura en medios fintech y tecnología |
| Programa de embajadores | Microinfluencers locales |

---

## 7. Análisis Competitivo Chile

| Competidor | Fortaleza | Debilidad | Nuestra Ventaja |
|---|---|---|---|
| **MercadoPago** | Marca, ecosistema ML | No nativo en WhatsApp | UX conversacional |
| **Flow.cl** | Penetración en e-commerce | Solo web, sin P2P | P2P + comercio |
| **MACH (BCI)** | Respaldo bancario, tarjeta virtual | App separada, no WhatsApp | Sin descarga extra |
| **Tenpo** | Fintech establecida | App separada | Integración WhatsApp |
| **Chek (Walmart)** | Base de clientes retail | Limitado a ecosistema Walmart | Abierto a todos |

### Diferenciador Principal

> **WhatPay es el único servicio de pagos nativo dentro de WhatsApp en Chile.**
> No requiere descargar otra app. El 67% de Chile ya está en WhatsApp.

---

## 8. Riesgos del Modelo de Negocio

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Meta lanza pagos nativos en WhatsApp Chile | Baja (2-3 años) | Crítico | Ser adquiridos o pivotar a valor agregado |
| Comisiones reguladas a la baja | Media | Alto | Diversificar a servicios premium |
| Competidor con más capital | Alta | Medio | Velocidad de ejecución, nicho PYME |
| Fraude masivo | Baja | Alto | Cloud AI + reglas progresivas |
| Baja adopción de comercios | Media | Alto | Onboarding presencial + 0% comisión primeros 3 meses |
