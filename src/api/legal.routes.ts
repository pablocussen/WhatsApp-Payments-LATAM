import { Router } from 'express';

const router = Router();

// ─── Terms of Service ──────────────────────────────────
router.get('/legal', (_req, res) => {
  res.json({
    termsOfService: {
      version: '1.0',
      effectiveDate: '2026-04-01',
      url: 'https://whatpay.cl/legal',
      summary: [
        'WhatPay es una plataforma de pagos peer-to-peer integrada con WhatsApp para Chile.',
        'WhatPay NO es un banco, institución financiera, ni ofrece préstamos de ningún tipo.',
        'WhatPay facilita transferencias de dinero en CLP (pesos chilenos) entre usuarios registrados.',
        'Los usuarios deben ser mayores de 18 años y residentes en Chile.',
        'Cada usuario es responsable de la seguridad de su PIN y su cuenta.',
        'WhatPay se reserva el derecho de suspender cuentas por actividad fraudulenta.',
        'Los límites de transacción están determinados por el nivel KYC del usuario.',
      ],
    },
    privacyPolicy: {
      version: '1.0',
      effectiveDate: '2026-04-01',
      url: 'https://whatpay.cl/privacidad',
      summary: [
        'Recopilamos: número WhatsApp, RUT (hasheado), nombre (opcional), historial de transacciones.',
        'El RUT se almacena como HMAC-SHA256, nunca en texto plano.',
        'El PIN se almacena como bcrypt hash (cost 12), nunca en texto plano.',
        'No vendemos ni compartimos datos personales con terceros.',
        'Los datos de transacciones se usan para operar el servicio y cumplir regulaciones.',
        'Puedes solicitar eliminación de tu cuenta y datos escribiendo a privacidad@whatpay.cl.',
        'Usamos WhatsApp Cloud API de Meta para mensajería (sujeto a política de privacidad de Meta).',
      ],
    },
    commerceDisclaimer: {
      description: 'WhatPay es una plataforma de pagos, no de préstamos.',
      clarifications: [
        'WhatPay NO facilita préstamos entre particulares (peer-to-peer lending).',
        'WhatPay NO opera con monedas virtuales, criptomonedas, ni tokens.',
        'WhatPay opera exclusivamente con CLP (pesos chilenos), moneda de curso legal en Chile.',
        'WhatPay NO es un banco ni una institución financiera regulada.',
        'WhatPay cumple con la Política de Comercio de WhatsApp Business.',
      ],
    },
    dataProtection: {
      law: 'Ley 19.628 sobre Protección de la Vida Privada (Chile)',
      controller: 'Asesorías Cussen SPA',
      contact: 'privacidad@whatpay.cl',
      rights: [
        'Acceso a tus datos personales.',
        'Rectificación de datos incorrectos.',
        'Eliminación de tu cuenta y datos.',
        'Oposición al tratamiento de datos.',
        'Revocación del consentimiento.',
      ],
    },
    whatsappCompliance: {
      optIn: 'Los usuarios aceptan recibir mensajes al crear su cuenta en WhatPay.',
      optOut: 'Los usuarios pueden dejar de recibir mensajes escribiendo /silenciar o bloqueando el número.',
      escalation: 'Los usuarios pueden contactar soporte humano escribiendo /soporte o a soporte@whatpay.cl.',
      dataMinimization: 'Solo enviamos datos necesarios para la transacción en mensajes a terceros.',
    },
  });
});

// ─── Consent status (authenticated) ─────────────────────
router.get('/legal/consents', async (req, res) => {
  // This would normally use JWT auth, but for now return the structure
  res.json({
    message: 'Usa el endpoint autenticado GET /api/v1/preferences para ver tus consentimientos.',
    requiredConsents: ['tos', 'privacy', 'messaging'],
    optionalConsents: ['marketing'],
    manageUrl: 'https://whatpay.cl/privacidad',
  });
});

export default router;
