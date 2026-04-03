/**
 * Internationalization (i18n) — bot message translations.
 * Default: Spanish (es). Supported: es, en.
 */

export type Locale = 'es' | 'en';

const messages: Record<string, Record<Locale, string>> = {
  // ── Registration ─────────────────────────────────
  'register.welcome': {
    es: 'Soy *WhatPay*, tu billetera en WhatsApp.',
    en: "I'm *WhatPay*, your WhatsApp wallet.",
  },
  'register.subtitle': {
    es: 'Envía y recibe plata sin salir del chat.\nCrear tu cuenta toma menos de 1 minuto.',
    en: 'Send and receive money without leaving the chat.\nCreating your account takes less than 1 minute.',
  },
  'register.terms': {
    es: 'Al crear tu cuenta aceptas nuestros Términos de Servicio y Política de Privacidad:\nwhatpay.cl/legal',
    en: 'By creating your account you accept our Terms of Service and Privacy Policy:\nwhatpay.cl/legal',
  },
  'register.cta': {
    es: 'Crear mi cuenta',
    en: 'Create my account',
  },
  'register.enterRut': {
    es: 'Escribe tu RUT (ej: 12.345.678-9):',
    en: 'Enter your RUT (e.g. 12.345.678-9):',
  },
  'register.success': {
    es: 'Listo, tu cuenta está creada 🎉',
    en: 'Done, your account is created 🎉',
  },
  'register.basicLevel': {
    es: '📊 Nivel Básico (hasta $200.000/mes)',
    en: '📊 Basic Level (up to $200,000/month)',
  },
  'register.topupPrompt': {
    es: 'Recarga saldo para hacer tu primer pago.',
    en: 'Top up your balance to make your first payment.',
  },

  // ── Menu ─────────────────────────────────────────
  'menu.whatDoYouNeed': {
    es: '¿Qué necesitas?',
    en: 'What do you need?',
  },
  'menu.sendMoney': {
    es: 'Enviar dinero',
    en: 'Send money',
  },
  'menu.charge': {
    es: 'Cobrar',
    en: 'Charge',
  },
  'menu.myWallet': {
    es: 'Mi billetera',
    en: 'My wallet',
  },

  // ── Balance ──────────────────────────────────────
  'balance.title': {
    es: '💰 *Mi billetera*',
    en: '💰 *My wallet*',
  },
  'balance.label': {
    es: 'Saldo',
    en: 'Balance',
  },
  'balance.topup': {
    es: 'Recargar',
    en: 'Top up',
  },
  'balance.history': {
    es: 'Movimientos',
    en: 'History',
  },

  // ── Payments ─────────────────────────────────────
  'pay.sent': {
    es: 'Pago enviado ✅',
    en: 'Payment sent ✅',
  },
  'pay.received': {
    es: 'Recibiste un pago 💸',
    en: 'You received a payment 💸',
  },
  'pay.anotherPayment': {
    es: 'Otro pago',
    en: 'Another payment',
  },
  'pay.returnPayment': {
    es: 'Devolver pago',
    en: 'Return payment',
  },
  'pay.enterPhone': {
    es: 'Escribe el número de WhatsApp del destinatario (ej: +56912345678):',
    en: 'Enter the recipient WhatsApp number (e.g. +56912345678):',
  },
  'pay.enterAmount': {
    es: 'Escribe el monto a enviar (ej: 5000):',
    en: 'Enter the amount to send (e.g. 5000):',
  },
  'pay.enterPin': {
    es: 'Escribe tu PIN de 6 dígitos para confirmar:',
    en: 'Enter your 6-digit PIN to confirm:',
  },

  // ── Charges ──────────────────────────────────────
  'charge.sentTo': {
    es: 'Cobro enviado a',
    en: 'Charge sent to',
  },
  'charge.noAccount': {
    es: 'no tiene cuenta WhatPay. Comparte el enlace directamente:',
    en: "doesn't have a WhatPay account. Share the link directly:",
  },
  'charge.payNow': {
    es: 'Pagar ahora',
    en: 'Pay now',
  },
  'charge.decline': {
    es: 'Rechazar',
    en: 'Decline',
  },

  // ── Support ──────────────────────────────────────
  'support.title': {
    es: '*Soporte WhatPay* 🛟',
    en: '*WhatPay Support* 🛟',
  },
  'support.contactUs': {
    es: 'Puedes contactarnos por:',
    en: 'You can reach us via:',
  },
  'support.hours': {
    es: '⏰ Lun-Vie 9:00 - 18:00 (hora Chile)',
    en: '⏰ Mon-Fri 9:00 - 18:00 (Chile time)',
  },
  'support.humanAgent': {
    es: 'Si necesitas hablar con una persona real, responde *"agente"* y te derivaremos.',
    en: 'If you need to speak with a real person, reply *"agent"* and we\'ll transfer you.',
  },

  // ── Errors ───────────────────────────────────────
  'error.invalidPhone': {
    es: 'Número inválido. Escribe un número chileno (ej: +56912345678):',
    en: 'Invalid number. Enter a Chilean number (e.g. +56912345678):',
  },
  'error.invalidPin': {
    es: 'PIN incorrecto.',
    en: 'Incorrect PIN.',
  },
  'error.tooManyRequests': {
    es: 'Demasiadas solicitudes. Intenta en unos minutos.',
    en: 'Too many requests. Try again in a few minutes.',
  },
  'error.insufficientFunds': {
    es: 'Saldo insuficiente.',
    en: 'Insufficient balance.',
  },

  // ── General ──────────────────────────────────────
  'general.confirm': {
    es: 'Confirmar',
    en: 'Confirm',
  },
  'general.cancel': {
    es: 'Cancelar',
    en: 'Cancel',
  },
  'general.yes': {
    es: 'Sí',
    en: 'Yes',
  },
  'general.no': {
    es: 'No',
    en: 'No',
  },
};

/**
 * Get a translated message. Falls back to Spanish if key or locale not found.
 */
export function t(key: string, locale: Locale = 'es'): string {
  const entry = messages[key];
  if (!entry) return key;
  return entry[locale] ?? entry.es ?? key;
}

/**
 * Get the greeting based on time of day.
 */
export function greetingI18n(name: string | null, locale: Locale = 'es'): string {
  const hour = parseInt(
    new Date().toLocaleString('en-US', { timeZone: 'America/Santiago', hour: 'numeric', hour12: false }),
    10,
  );
  const n = name ? ` ${name}` : '';

  if (locale === 'en') {
    if (hour >= 6 && hour < 12) return `Good morning${n}`;
    if (hour >= 12 && hour < 20) return `Good afternoon${n}`;
    return `Good evening${n}`;
  }

  if (hour >= 6 && hour < 12) return `Buenos días${n}`;
  if (hour >= 12 && hour < 20) return `Buenas tardes${n}`;
  return `Buenas noches${n}`;
}

/**
 * Get all supported locales.
 */
export function supportedLocales(): Locale[] {
  return ['es', 'en'];
}

/**
 * Check if a locale is supported.
 */
export function isValidLocale(locale: string): locale is Locale {
  return locale === 'es' || locale === 'en';
}
