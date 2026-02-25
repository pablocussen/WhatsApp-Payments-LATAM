# 03 - Flujos de Experiencia de Usuario (UX)

## Principios de Diseño UX

1. **Conversacional primero**: Todo se inicia y confirma dentro de WhatsApp
2. **Máximo 3 toques**: Ninguna acción de pago requiere más de 3 interacciones
3. **Lenguaje local**: Español chileno, informal pero confiable
4. **Sin descarga**: No se requiere instalar otra app (excepto WhatsApp)
5. **Confirmación visible**: Siempre se confirma el pago con mensaje claro

---

## Flujo 1: Registro de Usuario (Onboarding)

### Paso a paso

```
USUARIO                                    WHATPAY BOT
  │                                              │
  │  "Hola" / Escanea QR / Click en enlace       │
  │──────────────────────────────────────────────>│
  │                                              │
  │     "¡Hola! Soy WhatPay 💰                  │
  │      Envía y recibe pagos directo aquí.      │
  │      Para comenzar, necesito verificar       │
  │      tu identidad."                          │
  │                                              │
  │      [Comenzar registro]                     │
  │<──────────────────────────────────────────────│
  │                                              │
  │  Toca [Comenzar registro]                    │
  │──────────────────────────────────────────────>│
  │                                              │
  │      "Escribe tu RUT (ej: 12.345.678-9)"    │
  │<──────────────────────────────────────────────│
  │                                              │
  │  "12345678-9"                                │
  │──────────────────────────────────────────────>│
  │                                              │
  │      "Perfecto. Ahora crea un PIN de        │
  │       6 dígitos para autorizar tus pagos.   │
  │       No lo compartas con nadie."           │
  │<──────────────────────────────────────────────│
  │                                              │
  │  "483921"                                    │
  │──────────────────────────────────────────────>│
  │                                              │
  │      "Confirma tu PIN:"                      │
  │<──────────────────────────────────────────────│
  │                                              │
  │  "483921"                                    │
  │──────────────────────────────────────────────>│
  │                                              │
  │      "¡Listo, Pablo! Tu cuenta está activa.  │
  │       Nivel: Básico (hasta $200.000/mes)     │
  │                                              │
  │       ¿Qué quieres hacer?                    │
  │       [Enviar pago] [Cobrar] [Ver saldo]     │
  │       [Subir nivel]"                         │
  │<──────────────────────────────────────────────│
```

### Tiempo estimado: 90 segundos

---

## Flujo 2: Enviar Pago P2P (entre personas)

### Paso a paso

```
USUARIO (Pablo)                            WHATPAY BOT
  │                                              │
  │  "/pagar"  o  "Quiero pagar"                 │
  │──────────────────────────────────────────────>│
  │                                              │
  │      "¿A quién le quieres pagar?             │
  │       Escribe el número o elige              │
  │       un contacto reciente:"                 │
  │                                              │
  │       [+56 9 1234 5678 - María]              │
  │       [+56 9 8765 4321 - Juan]               │
  │       [Otro número]                          │
  │<──────────────────────────────────────────────│
  │                                              │
  │  Selecciona [María]                          │
  │──────────────────────────────────────────────>│
  │                                              │
  │      "¿Cuánto le quieres enviar a María?"    │
  │<──────────────────────────────────────────────│
  │                                              │
  │  "15000"                                     │
  │──────────────────────────────────────────────>│
  │                                              │
  │      "Confirma tu pago:                      │
  │       ────────────────────                   │
  │       Para: María (+56 9 1234 5678)          │
  │       Monto: $15.000 CLP                     │
  │       Comisión: $0 (P2P gratis)              │
  │       Desde: Saldo WhatPay                  │
  │       ────────────────────                   │
  │                                              │
  │       [Confirmar y pagar] [Cancelar]"        │
  │<──────────────────────────────────────────────│
  │                                              │
  │  Toca [Confirmar y pagar]                    │
  │──────────────────────────────────────────────>│
  │                                              │
  │      "Ingresa tu PIN de 6 dígitos:"          │
  │      (o usa tu huella dactilar)              │
  │<──────────────────────────────────────────────│
  │                                              │
  │  "483921" (o autenticación biométrica)       │
  │──────────────────────────────────────────────>│
  │                                              │
  │      "✅ Pago enviado exitosamente            │
  │       ────────────────────                   │
  │       $15.000 CLP → María                    │
  │       Ref: #WP-2026-00001234                 │
  │       Fecha: 25 Feb 2026, 14:32              │
  │       Saldo actual: $85.000 CLP              │
  │       ────────────────────"                  │
  │<──────────────────────────────────────────────│

  --- Simultáneamente, María recibe: ---

WHATPAY BOT                               MARÍA
  │                                              │
  │      "¡Tienes un pago!                       │
  │       ────────────────────                   │
  │       Pablo te envió $15.000 CLP             │
  │       Ref: #WP-2026-00001234                 │
  │       Tu saldo: $15.000 CLP                  │
  │       ────────────────────                   │
  │       [Ver saldo] [Retirar a banco]"         │
  │──────────────────────────────────────────────>│
```

### Tiempo estimado: 30 segundos (3 toques + PIN)

---

## Flujo 3: Cobrar con Enlace Compartible (Comercio)

### Paso a paso

```
COMERCIO (Tienda Café Lindo)               WHATPAY BOT
  │                                              │
  │  "/cobrar 3500 Café con leche"               │
  │──────────────────────────────────────────────>│
  │                                              │
  │      "Enlace de cobro creado:                │
  │       ────────────────────                   │
  │       Monto: $3.500 CLP                      │
  │       Concepto: Café con leche               │
  │       Enlace: whatpay.cl/c/A3xK9m            │
  │       Vence: 24 horas                        │
  │       ────────────────────                   │
  │                                              │
  │       [Compartir enlace] [Crear QR]          │
  │       [Cambiar monto]"                       │
  │<──────────────────────────────────────────────│
  │                                              │
  │  Comparte enlace al cliente por WhatsApp     │
  │                                              │

  --- El cliente recibe el enlace ---

CLIENTE                                    WHATPAY (Web)
  │                                              │
  │  Abre whatpay.cl/c/A3xK9m                    │
  │──────────────────────────────────────────────>│
  │                                              │
  │      ┌────────────────────────┐              │
  │      │    ☕ Café Lindo        │              │
  │      │                        │              │
  │      │  Café con leche        │              │
  │      │  $3.500 CLP            │              │
  │      │                        │              │
  │      │  [Pagar con WhatsApp]  │              │
  │      │  [Pagar con tarjeta]   │              │
  │      │  [Pagar con Khipu]     │              │
  │      └────────────────────────┘              │
  │<──────────────────────────────────────────────│
  │                                              │
  │  Selecciona [Pagar con WhatsApp]             │
  │──────────────────────────────────────────────>│
  │                                              │
  │      Redirige a WhatsApp →                   │
  │      Abre chat con WhatPay                  │
  │      Mensaje pre-llenado:                    │
  │      "Pagar $3.500 a Café Lindo #A3xK9m"    │
  │                                              │
  │  (Continúa flujo de pago con PIN)            │
```

---

## Flujo 4: Recargar Saldo (Wallet)

```
USUARIO                                    WHATPAY BOT
  │                                              │
  │  "/recargar"                                 │
  │──────────────────────────────────────────────>│
  │                                              │
  │      "¿Cuánto quieres recargar?              │
  │                                              │
  │       [$10.000] [$20.000] [$50.000]          │
  │       [Otro monto]"                          │
  │<──────────────────────────────────────────────│
  │                                              │
  │  Selecciona [$20.000]                        │
  │──────────────────────────────────────────────>│
  │                                              │
  │      "Elige cómo recargar:                   │
  │                                              │
  │       [Tarjeta débito/crédito]               │
  │       [Transferencia bancaria (Khipu)]"      │
  │<──────────────────────────────────────────────│
  │                                              │
  │  Selecciona [Tarjeta débito/crédito]         │
  │──────────────────────────────────────────────>│
  │                                              │
  │      "Abre enlace seguro de Transbank:       │
  │       🔒 webpay.transbank.cl/...             │
  │                                              │
  │       [Ir a pagar]"                          │
  │<──────────────────────────────────────────────│
  │                                              │
  │  (Completa pago en Transbank WebPay)         │
  │                                              │
  │      "✅ Recarga exitosa                      │
  │       +$20.000 CLP                           │
  │       Saldo actual: $105.000 CLP"            │
  │<──────────────────────────────────────────────│
```

---

## Flujo 5: Consultas Rápidas

```
Comandos disponibles:

/saldo          → "Tu saldo: $105.000 CLP"
/historial      → Últimas 5 transacciones con detalles
/ayuda          → Menú de ayuda con opciones
/cobrar [monto] → Genera enlace de cobro rápido
/pagar          → Inicia flujo de pago
/recargar       → Inicia recarga de saldo
/perfil         → Ver nivel KYC, límites, datos
/soporte        → Contactar agente humano
```

---

## Diseño de Mensajes Interactivos (WhatsApp)

### Botones de Respuesta Rápida (máx. 3)

```json
{
  "type": "button",
  "body": { "text": "¿Qué quieres hacer?" },
  "action": {
    "buttons": [
      { "type": "reply", "reply": { "id": "pay", "title": "Enviar pago" }},
      { "type": "reply", "reply": { "id": "charge", "title": "Cobrar" }},
      { "type": "reply", "reply": { "id": "balance", "title": "Ver saldo" }}
    ]
  }
}
```

### Lista Interactiva (para más opciones)

```json
{
  "type": "list",
  "body": { "text": "Selecciona una opción:" },
  "action": {
    "button": "Ver opciones",
    "sections": [{
      "title": "Pagos",
      "rows": [
        { "id": "pay_p2p", "title": "Enviar pago", "description": "Envía dinero a otro usuario" },
        { "id": "pay_merchant", "title": "Pagar comercio", "description": "Paga con enlace o QR" },
        { "id": "charge", "title": "Cobrar", "description": "Crea un enlace de cobro" }
      ]
    }, {
      "title": "Mi cuenta",
      "rows": [
        { "id": "balance", "title": "Ver saldo", "description": "Consulta tu saldo actual" },
        { "id": "history", "title": "Historial", "description": "Últimas transacciones" },
        { "id": "topup", "title": "Recargar", "description": "Agrega saldo a tu wallet" }
      ]
    }]
  }
}
```

---

## Manejo de Errores (UX)

| Error | Mensaje al Usuario |
|---|---|
| Saldo insuficiente | "No tienes saldo suficiente. Tu saldo es $X. [Recargar]" |
| PIN incorrecto (1er intento) | "PIN incorrecto. Te quedan 2 intentos." |
| PIN incorrecto (3 intentos) | "Cuenta bloqueada por seguridad. Contacta soporte: /soporte" |
| Destinatario no registrado | "Este número no tiene WhatPay. [Invitar por WhatsApp]" |
| Límite excedido | "Superaste tu límite mensual ($200.000). [Subir nivel de cuenta]" |
| Enlace expirado | "Este enlace de pago ya venció. Pide uno nuevo al comercio." |
| Timeout de pago | "El pago no se completó a tiempo. No se cobró nada. [Reintentar]" |
| Error del sistema | "Tuvimos un problema. Intenta en unos minutos. Si persiste: /soporte" |

---

## Métricas UX a Medir

| Métrica | Objetivo | Cómo se mide |
|---|---|---|
| Tiempo de onboarding | < 2 minutos | Timestamp inicio → fin registro |
| Tiempo de pago P2P | < 30 segundos | Timestamp comando → confirmación |
| Tasa de abandono en pago | < 15% | Pagos iniciados vs completados |
| NPS (Net Promoter Score) | > 50 | Encuesta post-transacción mensual |
| Tasa de error visible | < 1% | Errores / total transacciones |
| Resolución en primer contacto | > 80% | Tickets soporte resueltos sin escalamiento |
