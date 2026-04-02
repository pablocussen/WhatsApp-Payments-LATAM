#!/usr/bin/env node
/**
 * Generate complete OpenAPI 3.1 spec for WhatPay API.
 * Run: node scripts/gen-openapi.js > docs/openapi.json
 */

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'WhatPay API',
    description:
      'Plataforma de pagos peer-to-peer integrada con WhatsApp para Chile.\n\n' +
      '## Autenticación\n' +
      'La mayoría de endpoints requieren un JWT Bearer token obtenido en `POST /api/v1/users/login`.\n' +
      'Los endpoints admin requieren el header `x-admin-key`.\n\n' +
      '## Flujo típico\n' +
      '1. Registro vía bot WhatsApp (conversacional) o `POST /api/v1/users/register`\n' +
      '2. `POST /api/v1/users/login` → PIN → JWT (30 min)\n' +
      '3. `POST /api/v1/topup/webpay` → recarga wallet con Transbank\n' +
      '4. `POST /api/v1/payments/pay` → envía pago P2P\n' +
      '5. `POST /api/v1/payments/links` → crea link de cobro para comercios\n\n' +
      '## Niveles KYC\n' +
      '| Nivel | Límite por tx | Límite mensual |\n' +
      '|-------|--------------|----------------|\n' +
      '| `BASIC` | $50.000 | $200.000 |\n' +
      '| `INTERMEDIATE` | $500.000 | $2.000.000 |\n' +
      '| `FULL` | $2.000.000 | Sin límite |\n\n' +
      '## Seguridad\n' +
      '- PIN almacenado como bcrypt hash (cost 12)\n' +
      '- RUT almacenado como HMAC-SHA256 (nunca en claro)\n' +
      '- Bloqueo tras 3 intentos fallidos de PIN (15 min)\n' +
      '- Rate limiting por IP en todos los endpoints\n' +
      '- Todas las transferencias usan SELECT FOR UPDATE (sin double-spending)\n',
    version: '0.1.0',
    contact: { name: 'Pablo Cussen', url: 'https://cussen.cl', email: 'pablo@cussen.cl' },
    license: { name: 'Portfolio Project', url: 'https://cussen.cl/whatpay' },
  },
  servers: [
    { url: 'https://whatpay-api-930472612593.southamerica-west1.run.app', description: 'Producción (GCP Cloud Run — Santiago)' },
    { url: 'http://localhost:3000', description: 'Desarrollo local' },
  ],
  tags: [
    { name: 'system', description: 'Estado del servicio' },
    { name: 'users', description: 'Registro, autenticación y perfil' },
    { name: 'payments', description: 'Pagos P2P, links de cobro, historial y saldo' },
    { name: 'topup', description: 'Recargas de wallet vía Transbank WebPay y Khipu' },
    { name: 'merchants', description: 'Dashboard, transacciones y liquidaciones para comercios' },
    { name: 'webhook', description: 'Webhook WhatsApp Cloud API (uso interno de Meta)' },
    { name: 'waitlist', description: 'Lista de espera para early access' },
    { name: 'referrals', description: 'Sistema de referidos' },
    { name: 'loyalty', description: 'Programa de fidelización y recompensas' },
    { name: 'promotions', description: 'Promociones y códigos de descuento' },
    { name: 'disputes', description: 'Disputas y resolución de conflictos' },
    { name: 'kyc', description: 'Verificación de identidad y documentos' },
    { name: 'merchant-onboarding', description: 'Postulación y aprobación de comercios' },
    { name: 'preferences', description: 'Preferencias de usuario' },
    { name: 'spending-limits', description: 'Límites de gasto personalizados' },
    { name: 'beneficiaries', description: 'Contactos frecuentes para pagos' },
    { name: 'notification-templates', description: 'Plantillas de notificación (admin)' },
    { name: 'reports', description: 'Reportes programados (admin)' },
    { name: 'compliance', description: 'Cumplimiento normativo (admin)' },
    { name: 'fees', description: 'Configuración de comisiones (admin)' },
    { name: 'settlements', description: 'Liquidaciones a comercios (admin)' },
    { name: 'analytics', description: 'Métricas y analytics (admin)' },
    { name: 'exports', description: 'Exportación de transacciones (admin)' },
    { name: 'merchant-analytics', description: 'Analytics por comercio (admin)' },
    { name: 'merchant-webhooks', description: 'Webhooks de comercios (admin)' },
    { name: 'contacts', description: 'Lista de contactos del usuario' },
    { name: 'activity', description: 'Log de actividad (admin)' },
    { name: 'api-keys', description: 'API Keys para comercios (admin)' },
    { name: 'currency', description: 'Monedas y tasas de cambio' },
    { name: 'notification-prefs', description: 'Preferencias de notificación' },
    { name: 'receipts', description: 'Comprobantes de pago' },
    { name: 'subscriptions', description: 'Pagos recurrentes / suscripciones' },
    { name: 'platform', description: 'Estado de la plataforma' },
    { name: 'webhook-events', description: 'Suscripciones a eventos webhook (admin)' },
    { name: 'rate-limits', description: 'Configuración de rate limiting (admin)' },
    { name: 'qr', description: 'Pagos por código QR' },
    { name: 'splits', description: 'División de cuentas (split payments)' },
    { name: 'scheduled-transfers', description: 'Transferencias programadas' },
    { name: 'payment-requests', description: 'Solicitudes de pago' },
    { name: 'admin', description: 'Endpoints administrativos' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Token JWT obtenido en POST /api/v1/users/login',
      },
      adminKey: {
        type: 'apiKey',
        in: 'header',
        name: 'x-admin-key',
        description: 'API key de administrador',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: { error: { type: 'string', example: 'Datos inválidos.' } },
      },
      AuthResponse: {
        type: 'object',
        properties: {
          token: { type: 'string', description: 'JWT Bearer token (expira en 30 min)' },
          user: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              name: { type: 'string', nullable: true },
              kycLevel: { type: 'string', enum: ['BASIC', 'INTERMEDIATE', 'FULL'] },
            },
          },
        },
      },
      UserProfile: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          waId: { type: 'string', example: '+56912345678' },
          name: { type: 'string', nullable: true },
          kycLevel: { type: 'string', enum: ['BASIC', 'INTERMEDIATE', 'FULL'] },
          biometricEnabled: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          balance: {
            type: 'object',
            properties: {
              amount: { type: 'integer', example: 25000 },
              formatted: { type: 'string', example: '$25.000 CLP' },
            },
          },
          stats: {
            type: 'object',
            properties: {
              totalSent: { type: 'integer' },
              totalReceived: { type: 'integer' },
              txCount: { type: 'integer' },
            },
          },
        },
      },
      Pagination: {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          pageSize: { type: 'integer' },
          total: { type: 'integer' },
        },
      },
    },
    parameters: {
      pageParam: { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
      pageSizeParam: { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
      limitParam: { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
    },
  },
  paths: {},
};

// Helpers
const jwt = [{ bearerAuth: [] }];
const admin = [{ adminKey: [] }];
const none = [];

const err401 = { '401': { description: 'Token inválido o expirado' } };
const err401admin = { '401': { description: 'API key inválida o ausente' } };
const err404 = { '404': { description: 'No encontrado', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } };
const err400 = { '400': { description: 'Datos inválidos', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } };

function ok(desc, example) {
  return { '200': { description: desc, content: { 'application/json': { example } } } };
}
function created(desc, example) {
  return { '201': { description: desc, content: { 'application/json': { example } } } };
}
function pathParam(name, desc, format) {
  return { name, in: 'path', required: true, schema: { type: 'string', ...(format ? { format } : {}) }, description: desc };
}
function queryParam(name, desc, schema) {
  return { name, in: 'query', schema, description: desc };
}
function body(required, props) {
  return {
    required: true,
    content: {
      'application/json': {
        schema: { type: 'object', required, properties: props },
      },
    },
  };
}

const p = spec.paths;

// ══════════════════════════════════════════════════
// SYSTEM
// ══════════════════════════════════════════════════
p['/'] = {
  get: {
    tags: ['system'], summary: 'Info del servicio', security: none,
    responses: ok('Info del servicio', { service: 'whatpay-api', version: '0.1.0', status: 'ok', docs: '/api/docs', health: '/health' }),
  },
};
p['/health'] = {
  get: {
    tags: ['system'], summary: 'Health check', description: 'Estado del servicio, Redis y base de datos. Usado por Cloud Run liveness probe.', security: none,
    responses: {
      ...ok('Servicio operativo', { status: 'ok', service: 'whatpay-api', checks: { redis: { status: 'ok', latencyMs: 2 }, db: { status: 'ok', latencyMs: 5 } } }),
      '503': { description: 'Servicio degradado' },
    },
  },
};

// ══════════════════════════════════════════════════
// WEBHOOK
// ══════════════════════════════════════════════════
p['/api/v1/webhook'] = {
  get: {
    tags: ['webhook'], summary: 'Verificar webhook (Meta challenge)', security: none,
    parameters: [
      queryParam('hub.mode', 'Modo de suscripción', { type: 'string', enum: ['subscribe'] }),
      queryParam('hub.verify_token', 'Token de verificación', { type: 'string' }),
      queryParam('hub.challenge', 'Challenge de Meta', { type: 'string' }),
    ],
    responses: { '200': { description: 'Challenge devuelto como texto plano' }, '403': { description: 'Token incorrecto' } },
  },
  post: {
    tags: ['webhook'], summary: 'Recibir mensajes de WhatsApp', security: none,
    description: 'WhatsApp Cloud API envía mensajes aquí. Valida HMAC-SHA256, aplica deduplicación por message.id en Redis (TTL 5 min).',
    responses: { '200': { description: 'Recibido' }, '401': { description: 'Firma HMAC inválida' } },
  },
};

// ══════════════════════════════════════════════════
// USERS
// ══════════════════════════════════════════════════
p['/api/v1/users/register'] = {
  post: {
    tags: ['users'], summary: 'Registrar usuario', security: none,
    description: 'Crea una cuenta nueva. RUT validado y almacenado como HMAC-SHA256. PIN como bcrypt (cost 12). Rate limit: 3/hora/IP.',
    requestBody: body(['waId', 'rut', 'pin'], {
      waId: { type: 'string', example: '+56912345678' },
      rut: { type: 'string', example: '12345678-9' },
      pin: { type: 'string', minLength: 6, maxLength: 6, example: '483920' },
      name: { type: 'string', example: 'Juan Pérez' },
    }),
    responses: { ...created('Usuario creado', { token: 'eyJ...', user: { id: 'uuid', kycLevel: 'BASIC' } }), ...err400 },
  },
};
p['/api/v1/users/login'] = {
  post: {
    tags: ['users'], summary: 'Autenticar con PIN', security: none,
    description: 'Verifica PIN con bcrypt → JWT (30 min). Bloqueo tras 3 intentos fallidos (15 min).',
    requestBody: body(['waId', 'pin'], {
      waId: { type: 'string', example: '+56912345678' },
      pin: { type: 'string', example: '483920' },
    }),
    responses: {
      ...ok('JWT generado', { token: 'eyJ...', user: { id: 'uuid', kycLevel: 'BASIC' } }),
      '401': { description: 'PIN incorrecto' },
      '423': { description: 'Cuenta bloqueada (15 min)' },
    },
  },
};
p['/api/v1/users/me'] = {
  get: {
    tags: ['users'], summary: 'Perfil del usuario autenticado', security: jwt,
    responses: { '200': { description: 'Perfil', content: { 'application/json': { schema: { $ref: '#/components/schemas/UserProfile' } } } }, ...err401 },
  },
};

// ══════════════════════════════════════════════════
// PAYMENTS
// ══════════════════════════════════════════════════
p['/api/v1/payments/pay'] = {
  post: {
    tags: ['payments'], summary: 'Enviar pago P2P', security: jwt,
    description: 'Transferencia wallet-to-wallet. Sin comisión con método WALLET. SELECT FOR UPDATE previene double-spending.',
    requestBody: body(['receiverId', 'amount', 'paymentMethod'], {
      receiverId: { type: 'string', format: 'uuid' },
      amount: { type: 'integer', minimum: 100, maximum: 2000000, example: 8500 },
      paymentMethod: { type: 'string', enum: ['WALLET', 'WEBPAY_CREDIT', 'WEBPAY_DEBIT', 'KHIPU'] },
      description: { type: 'string', maxLength: 500 },
      paymentLinkId: { type: 'string', format: 'uuid' },
    }),
    responses: { ...created('Pago completado', { success: true, reference: '#WP-2026-A7F3B2C4', amount: 8500 }), ...err400, ...err401 },
  },
};
p['/api/v1/payments/refund'] = {
  post: {
    tags: ['payments'], summary: 'Reembolsar pago recibido', security: jwt,
    requestBody: body(['reference'], { reference: { type: 'string', example: '#WP-2026-A7F3B2C4' } }),
    responses: { ...ok('Reembolso procesado', { success: true }), ...err400, ...err401 },
  },
};
p['/api/v1/payments/history'] = {
  get: {
    tags: ['payments'], summary: 'Historial de transacciones', security: jwt,
    parameters: [queryParam('limit', 'Máximo de resultados', { type: 'integer', default: 20 })],
    responses: { ...ok('Historial', { history: '...' }), ...err401 },
  },
};
p['/api/v1/payments/wallet/balance'] = {
  get: {
    tags: ['payments'], summary: 'Consultar saldo del wallet', security: jwt,
    responses: { ...ok('Saldo', { amount: 25000, formatted: '$25.000 CLP' }), ...err401 },
  },
};
p['/api/v1/payments/links'] = {
  post: {
    tags: ['payments'], summary: 'Crear link de cobro', security: jwt,
    requestBody: body([], {
      amount: { type: 'integer', minimum: 100, example: 15000 },
      description: { type: 'string', maxLength: 500 },
      expiresInHours: { type: 'integer', default: 24 },
      maxUses: { type: 'integer' },
    }),
    responses: { ...created('Link creado', { id: 'uuid', shortCode: 'a1B2c3', url: '...' }), ...err401 },
  },
  get: {
    tags: ['payments'], summary: 'Listar links activos', security: jwt,
    responses: { ...ok('Links', { links: [] }), ...err401 },
  },
};
p['/api/v1/payments/links/{code}'] = {
  get: {
    tags: ['payments'], summary: 'Resolver link de cobro (público)', security: none,
    parameters: [pathParam('code', 'Código corto del link')],
    responses: { ...ok('Info del link', { shortCode: 'a1B2c3', amount: 15000 }), ...err404 },
  },
};
p['/api/v1/payments/links/{id}'] = {
  delete: {
    tags: ['payments'], summary: 'Desactivar link de cobro', security: jwt,
    parameters: [pathParam('id', 'ID del link', 'uuid')],
    responses: { ...ok('Desactivado', { message: 'Enlace desactivado.' }), ...err401, ...err404 },
  },
};

// ══════════════════════════════════════════════════
// TOPUP
// ══════════════════════════════════════════════════
p['/api/v1/topup/webpay'] = {
  post: {
    tags: ['topup'], summary: 'Iniciar recarga con Transbank WebPay', security: jwt,
    requestBody: body(['amount'], { amount: { type: 'integer', minimum: 1000, maximum: 500000, example: 10000 } }),
    responses: { ...ok('URL de pago', { redirectUrl: 'https://webpay3g.transbank.cl/...', token: '...', amount: 10000 }), ...err400, ...err401 },
  },
};
p['/api/v1/topup/webpay/callback'] = {
  post: {
    tags: ['topup'], summary: 'Callback Transbank (interno)', security: none,
    responses: { '302': { description: 'Redirige a /topup/success o /topup/error' } },
  },
};
p['/api/v1/topup/khipu'] = {
  post: {
    tags: ['topup'], summary: 'Iniciar recarga con Khipu', security: jwt,
    requestBody: body(['amount'], { amount: { type: 'integer', minimum: 1000, maximum: 500000, example: 10000 } }),
    responses: { ...ok('URL de pago', { paymentUrl: 'https://khipu.com/...', paymentId: 'abc', amount: 10000 }), ...err400, ...err401 },
  },
};
p['/api/v1/topup/khipu/notify'] = {
  post: {
    tags: ['topup'], summary: 'Notificación Khipu (interno)', security: none,
    responses: { '200': { description: 'Notificación recibida' } },
  },
};

// ══════════════════════════════════════════════════
// MERCHANTS
// ══════════════════════════════════════════════════
p['/api/v1/merchants/dashboard'] = {
  get: { tags: ['merchants'], summary: 'Dashboard del comercio', description: 'Requiere KYC INTERMEDIATE+.', security: jwt, responses: { ...ok('Dashboard', {}), ...err401 } },
};
p['/api/v1/merchants/transactions'] = {
  get: {
    tags: ['merchants'], summary: 'Transacciones del comercio', security: jwt,
    parameters: [{ $ref: '#/components/parameters/pageParam' }, { $ref: '#/components/parameters/pageSizeParam' }],
    responses: { ...ok('Transacciones', { transactions: [], total: 0, page: 1 }), ...err401 },
  },
};
p['/api/v1/merchants/settlement'] = {
  get: {
    tags: ['merchants'], summary: 'Reporte de liquidación', security: jwt,
    parameters: [
      queryParam('start', 'Inicio del período', { type: 'string', format: 'date-time' }),
      queryParam('end', 'Fin del período', { type: 'string', format: 'date-time' }),
    ],
    responses: { ...ok('Reporte', { totalRevenue: 450000, netRevenue: 445500, transactionCount: 23 }), ...err401 },
  },
};

// ══════════════════════════════════════════════════
// MERCHANT ONBOARDING
// ══════════════════════════════════════════════════
p['/api/v1/merchants/apply'] = {
  post: {
    tags: ['merchant-onboarding'], summary: 'Postular como comercio', security: jwt,
    requestBody: body(['businessName', 'businessType', 'rut', 'contactEmail', 'contactPhone', 'category', 'description'], {
      businessName: { type: 'string' }, businessType: { type: 'string' }, rut: { type: 'string' },
      contactEmail: { type: 'string', format: 'email' }, contactPhone: { type: 'string' },
      category: { type: 'string' }, description: { type: 'string' },
    }),
    responses: { ...created('Postulación enviada', { application: {} }), ...err400, ...err401 },
  },
};
p['/api/v1/merchants/application'] = {
  get: { tags: ['merchant-onboarding'], summary: 'Ver mi postulación', security: jwt, responses: { ...ok('Postulación', { application: {} }), ...err401, ...err404 } },
};
p['/api/v1/merchants/queue'] = {
  get: {
    tags: ['merchant-onboarding'], summary: 'Cola de postulaciones pendientes', security: admin,
    parameters: [{ $ref: '#/components/parameters/limitParam' }],
    responses: { ...ok('Cola', { queue: [], count: 0 }), ...err401admin },
  },
};
p['/api/v1/merchants/applications/{id}'] = {
  get: { tags: ['merchant-onboarding'], summary: 'Detalle de postulación', security: admin, parameters: [pathParam('id', 'ID')], responses: { ...ok('Detalle', {}), ...err401admin } },
};
p['/api/v1/merchants/applications/{id}/review'] = {
  post: {
    tags: ['merchant-onboarding'], summary: 'Revisar postulación', security: admin,
    parameters: [pathParam('id', 'ID')],
    requestBody: body(['status'], { status: { type: 'string', enum: ['approved', 'rejected'] }, notes: { type: 'string' } }),
    responses: { ...ok('Revisada', {}), ...err401admin },
  },
};
p['/api/v1/merchants/applications/{id}/suspend'] = {
  post: {
    tags: ['merchant-onboarding'], summary: 'Suspender comercio', security: admin,
    parameters: [pathParam('id', 'ID')],
    requestBody: body([], { reason: { type: 'string' } }),
    responses: { ...ok('Suspendido', {}), ...err401admin },
  },
};

// ══════════════════════════════════════════════════
// WAITLIST
// ══════════════════════════════════════════════════
p['/api/v1/waitlist'] = {
  post: {
    tags: ['waitlist'], summary: 'Unirse a la lista de espera', security: none,
    description: 'Rate limit: 5/hora por IP.',
    requestBody: body(['email'], { email: { type: 'string', format: 'email' } }),
    responses: { ...ok('Registrado', { status: 'added', message: 'Te notificaremos.' }), ...err400 },
  },
};
p['/api/v1/waitlist/count'] = {
  get: { tags: ['waitlist'], summary: 'Conteo de inscritos', security: none, responses: ok('Conteo', { count: 42 }) },
};

// ══════════════════════════════════════════════════
// REFERRALS
// ══════════════════════════════════════════════════
p['/api/v1/referrals/my-code'] = {
  get: { tags: ['referrals'], summary: 'Mi código de referido', security: jwt, responses: { ...ok('Código', { code: 'ABC123', shareLink: '...' }), ...err401 } },
};
p['/api/v1/referrals/stats'] = {
  get: { tags: ['referrals'], summary: 'Estadísticas de referidos', security: jwt, responses: { ...ok('Stats', { code: 'ABC123', stats: {}, referrals: [] }), ...err401 } },
};
p['/api/v1/referrals/apply'] = {
  post: {
    tags: ['referrals'], summary: 'Aplicar código de referido', security: jwt,
    requestBody: body(['code'], { code: { type: 'string', example: 'ABC123' } }),
    responses: { ...ok('Aplicado', { message: 'Referido aplicado', referral: {} }), ...err400, ...err401 },
  },
};
p['/api/v1/referrals/validate/{code}'] = {
  get: {
    tags: ['referrals'], summary: 'Validar código de referido (público)', security: none,
    parameters: [pathParam('code', 'Código')],
    responses: ok('Resultado', { valid: true, rewardForReferred: 1000 }),
  },
};

// ══════════════════════════════════════════════════
// LOYALTY
// ══════════════════════════════════════════════════
p['/api/v1/loyalty/account'] = {
  get: { tags: ['loyalty'], summary: 'Mi cuenta de fidelización', security: jwt, responses: { ...ok('Cuenta', { account: {}, tierInfo: {} }), ...err401 } },
};
p['/api/v1/loyalty/history'] = {
  get: {
    tags: ['loyalty'], summary: 'Historial de puntos', security: jwt,
    parameters: [{ $ref: '#/components/parameters/limitParam' }],
    responses: { ...ok('Historial', { history: [], count: 0 }), ...err401 },
  },
};
p['/api/v1/loyalty/rewards'] = {
  get: { tags: ['loyalty'], summary: 'Recompensas disponibles (público)', security: none, responses: ok('Recompensas', { rewards: [] }) },
};
p['/api/v1/loyalty/redeem'] = {
  post: {
    tags: ['loyalty'], summary: 'Canjear puntos', security: jwt,
    requestBody: body(['points'], { points: { type: 'integer', minimum: 1 }, description: { type: 'string' } }),
    responses: { ...ok('Canjeado', { message: 'Puntos canjeados', remaining: 500 }), ...err400, ...err401 },
  },
};

// ══════════════════════════════════════════════════
// PROMOTIONS
// ══════════════════════════════════════════════════
p['/api/v1/promotions'] = {
  get: { tags: ['promotions'], summary: 'Listar promociones activas (público)', security: none, responses: ok('Promociones', { promotions: [] }) },
  post: {
    tags: ['promotions'], summary: 'Crear promoción', security: admin,
    requestBody: body(['code', 'type', 'value'], {
      code: { type: 'string' }, type: { type: 'string', enum: ['percentage', 'fixed'] },
      value: { type: 'number' }, maxUses: { type: 'integer' },
      startDate: { type: 'string', format: 'date-time' }, endDate: { type: 'string', format: 'date-time' },
    }),
    responses: { ...created('Creada', { promo: {} }), ...err401admin },
  },
};
p['/api/v1/promotions/validate/{code}'] = {
  get: {
    tags: ['promotions'], summary: 'Validar código promocional (público)', security: none,
    parameters: [pathParam('code', 'Código'), queryParam('amount', 'Monto', { type: 'integer' })],
    responses: ok('Validación', { valid: true, promo: {} }),
  },
};
p['/api/v1/promotions/apply'] = {
  post: {
    tags: ['promotions'], summary: 'Aplicar código promocional', security: jwt,
    requestBody: body(['code', 'amount'], { code: { type: 'string' }, amount: { type: 'integer' } }),
    responses: { ...ok('Aplicado', { applied: {} }), ...err400, ...err401 },
  },
};
p['/api/v1/promotions/{id}'] = {
  delete: {
    tags: ['promotions'], summary: 'Desactivar promoción', security: admin,
    parameters: [pathParam('id', 'ID')],
    responses: { ...ok('Desactivada', { message: 'Promoción desactivada' }), ...err401admin },
  },
};
p['/api/v1/promotions/{id}/stats'] = {
  get: {
    tags: ['promotions'], summary: 'Estadísticas de promoción', security: admin,
    parameters: [pathParam('id', 'ID')],
    responses: { ...ok('Stats', { promo: {}, stats: {} }), ...err401admin },
  },
};

// ══════════════════════════════════════════════════
// DISPUTES
// ══════════════════════════════════════════════════
p['/api/v1/disputes'] = {
  post: {
    tags: ['disputes'], summary: 'Abrir disputa', security: jwt,
    requestBody: body(['transactionRef', 'reason', 'description'], {
      transactionRef: { type: 'string' }, reason: { type: 'string' }, description: { type: 'string' }, merchantId: { type: 'string' },
    }),
    responses: { ...created('Disputa abierta', { dispute: {} }), ...err400, ...err401 },
  },
  get: { tags: ['disputes'], summary: 'Mis disputas', security: jwt, responses: { ...ok('Disputas', { disputes: [], count: 0 }), ...err401 } },
};
p['/api/v1/disputes/{id}'] = {
  get: {
    tags: ['disputes'], summary: 'Detalle de disputa', security: jwt,
    parameters: [pathParam('id', 'ID')],
    responses: { ...ok('Detalle', { dispute: {} }), ...err401, ...err404 },
  },
};
p['/api/v1/disputes/{id}/status'] = {
  post: {
    tags: ['disputes'], summary: 'Actualizar estado de disputa', security: admin,
    parameters: [pathParam('id', 'ID')],
    requestBody: body(['status'], { status: { type: 'string', enum: ['resolved', 'rejected', 'escalated'] }, resolution: { type: 'string' } }),
    responses: { ...ok('Actualizada', { dispute: {} }), ...err401admin },
  },
};

// ══════════════════════════════════════════════════
// KYC
// ══════════════════════════════════════════════════
p['/api/v1/kyc/documents'] = {
  post: {
    tags: ['kyc'], summary: 'Subir documento KYC', security: jwt,
    requestBody: body(['type', 'fileName', 'mimeType', 'fileSize', 'storageUrl'], {
      type: { type: 'string' }, fileName: { type: 'string' }, mimeType: { type: 'string' },
      fileSize: { type: 'integer' }, storageUrl: { type: 'string' },
    }),
    responses: { ...created('Documento subido', { document: {} }), ...err400, ...err401 },
  },
  get: { tags: ['kyc'], summary: 'Mis documentos KYC', security: jwt, responses: { ...ok('Documentos', { documents: [], stats: {} }), ...err401 } },
};
p['/api/v1/kyc/requirements'] = {
  get: {
    tags: ['kyc'], summary: 'Requisitos por nivel KYC (público)', security: none,
    parameters: [queryParam('tier', 'Nivel', { type: 'string', enum: ['BASIC', 'INTERMEDIATE', 'FULL'] })],
    responses: ok('Requisitos', { requirements: [] }),
  },
};
p['/api/v1/kyc/eligibility'] = {
  get: {
    tags: ['kyc'], summary: 'Verificar elegibilidad de nivel', security: jwt,
    parameters: [queryParam('tier', 'Nivel objetivo', { type: 'string' })],
    responses: { ...ok('Elegibilidad', {}), ...err401 },
  },
};
p['/api/v1/kyc/verify'] = {
  post: {
    tags: ['kyc'], summary: 'Iniciar verificación', security: jwt,
    requestBody: body(['targetTier'], { targetTier: { type: 'string', enum: ['INTERMEDIATE', 'FULL'] } }),
    responses: { ...created('Verificación iniciada', { verification: {} }), ...err400, ...err401 },
  },
};
p['/api/v1/kyc/verifications'] = {
  get: { tags: ['kyc'], summary: 'Mis verificaciones', security: jwt, responses: { ...ok('Verificaciones', { verifications: [], count: 0 }), ...err401 } },
};
p['/api/v1/kyc/documents/{id}/review'] = {
  post: {
    tags: ['kyc'], summary: 'Revisar documento (admin)', security: admin,
    parameters: [pathParam('id', 'ID')],
    requestBody: body(['decision'], { decision: { type: 'string', enum: ['approved', 'rejected'] }, rejectionReason: { type: 'string' } }),
    responses: { ...ok('Revisado', { document: {} }), ...err401admin },
  },
};
p['/api/v1/kyc/verifications/{id}/complete'] = {
  post: {
    tags: ['kyc'], summary: 'Completar verificación (admin)', security: admin,
    parameters: [pathParam('id', 'ID')],
    requestBody: body(['decision'], { decision: { type: 'string', enum: ['approved', 'rejected'] }, notes: { type: 'string' } }),
    responses: { ...ok('Completada', { verification: {} }), ...err401admin },
  },
};

// ══════════════════════════════════════════════════
// USER PREFERENCES
// ══════════════════════════════════════════════════
p['/api/v1/preferences'] = {
  get: { tags: ['preferences'], summary: 'Obtener preferencias', security: jwt, responses: { ...ok('Preferencias', { preferences: { language: 'es' } }), ...err401 } },
  post: {
    tags: ['preferences'], summary: 'Actualizar preferencias', security: jwt,
    requestBody: body([], {
      language: { type: 'string', enum: ['es', 'en'] }, receiptFormat: { type: 'string' },
      confirmBeforePay: { type: 'boolean' }, showBalanceOnGreet: { type: 'boolean' },
      defaultTipPercent: { type: 'integer' }, nickName: { type: 'string' },
    }),
    responses: { ...ok('Actualizado', { preferences: {} }), ...err401 },
  },
  delete: { tags: ['preferences'], summary: 'Resetear preferencias', security: jwt, responses: { ...ok('Reseteado', { preferences: {}, message: 'Reset' }), ...err401 } },
};

// ══════════════════════════════════════════════════
// SPENDING LIMITS
// ══════════════════════════════════════════════════
p['/api/v1/spending-limits'] = {
  get: { tags: ['spending-limits'], summary: 'Obtener límites', security: jwt, responses: { ...ok('Límites', { limits: {} }), ...err401 } },
  post: {
    tags: ['spending-limits'], summary: 'Configurar límites', security: jwt,
    requestBody: body([], { dailyLimit: { type: 'integer' }, weeklyLimit: { type: 'integer' }, alertThreshold: { type: 'number' } }),
    responses: { ...ok('Configurado', { limits: {} }), ...err401 },
  },
};
p['/api/v1/spending-limits/status'] = {
  get: { tags: ['spending-limits'], summary: 'Estado de límites', security: jwt, responses: { ...ok('Estado', { status: {} }), ...err401 } },
};
p['/api/v1/spending-limits/{userId}'] = {
  post: {
    tags: ['spending-limits'], summary: 'Configurar límites de usuario (admin)', security: admin,
    parameters: [pathParam('userId', 'ID del usuario')],
    requestBody: body([], { dailyLimit: { type: 'integer' }, weeklyLimit: { type: 'integer' } }),
    responses: { ...ok('Configurado', {}), ...err401admin },
  },
};

// ══════════════════════════════════════════════════
// BENEFICIARIES
// ══════════════════════════════════════════════════
p['/api/v1/beneficiaries'] = {
  get: { tags: ['beneficiaries'], summary: 'Listar beneficiarios', security: jwt, responses: { ...ok('Lista', { beneficiaries: [], count: 0 }), ...err401 } },
  post: {
    tags: ['beneficiaries'], summary: 'Agregar beneficiario', security: jwt,
    requestBody: body(['name', 'phone'], { name: { type: 'string' }, phone: { type: 'string' }, alias: { type: 'string' }, defaultAmount: { type: 'integer' } }),
    responses: { ...created('Agregado', { beneficiary: {} }), ...err400, ...err401 },
  },
};
p['/api/v1/beneficiaries/{id}/update'] = {
  post: {
    tags: ['beneficiaries'], summary: 'Actualizar beneficiario', security: jwt,
    parameters: [pathParam('id', 'ID')],
    requestBody: body([], { name: { type: 'string' }, alias: { type: 'string' }, defaultAmount: { type: 'integer' } }),
    responses: { ...ok('Actualizado', { beneficiary: {} }), ...err401 },
  },
};
p['/api/v1/beneficiaries/{id}'] = {
  delete: { tags: ['beneficiaries'], summary: 'Eliminar beneficiario', security: jwt, parameters: [pathParam('id', 'ID')], responses: { ...ok('Eliminado', { message: 'ok' }), ...err401 } },
};
p['/api/v1/beneficiaries/search'] = {
  get: {
    tags: ['beneficiaries'], summary: 'Buscar por teléfono', security: jwt,
    parameters: [queryParam('phone', 'Teléfono', { type: 'string' })],
    responses: { ...ok('Resultado', { beneficiary: {} }), ...err401 },
  },
};

// ══════════════════════════════════════════════════
// NOTIFICATION TEMPLATES (admin)
// ══════════════════════════════════════════════════
p['/api/v1/notification-templates'] = {
  get: {
    tags: ['notification-templates'], summary: 'Listar plantillas', security: admin,
    parameters: [queryParam('channel', 'Canal', { type: 'string' }), queryParam('category', 'Categoría', { type: 'string' })],
    responses: { ...ok('Plantillas', { templates: [], count: 0 }), ...err401admin },
  },
  post: {
    tags: ['notification-templates'], summary: 'Crear plantilla', security: admin,
    requestBody: body(['name', 'channel', 'category', 'body'], {
      name: { type: 'string' }, channel: { type: 'string' }, category: { type: 'string' },
      subject: { type: 'string' }, body: { type: 'string' }, locale: { type: 'string' },
    }),
    responses: { ...created('Creada', { template: {} }), ...err401admin },
  },
};
p['/api/v1/notification-templates/{id}'] = {
  get: { tags: ['notification-templates'], summary: 'Obtener plantilla', security: admin, parameters: [pathParam('id', 'ID')], responses: { ...ok('Plantilla', { template: {} }), ...err401admin } },
  delete: { tags: ['notification-templates'], summary: 'Desactivar plantilla', security: admin, parameters: [pathParam('id', 'ID')], responses: { ...ok('Desactivada', { message: 'ok' }), ...err401admin } },
};
p['/api/v1/notification-templates/{id}/update'] = {
  post: {
    tags: ['notification-templates'], summary: 'Actualizar plantilla', security: admin,
    parameters: [pathParam('id', 'ID')],
    requestBody: body([], { name: { type: 'string' }, body: { type: 'string' }, subject: { type: 'string' } }),
    responses: { ...ok('Actualizada', { template: {} }), ...err401admin },
  },
};
p['/api/v1/notification-templates/{id}/render'] = {
  post: {
    tags: ['notification-templates'], summary: 'Renderizar plantilla', security: admin,
    parameters: [pathParam('id', 'ID')],
    requestBody: body(['variables'], { variables: { type: 'object' } }),
    responses: { ...ok('Renderizada', { rendered: '' }), ...err401admin },
  },
};

// ══════════════════════════════════════════════════
// REPORTS (admin)
// ══════════════════════════════════════════════════
p['/api/v1/reports'] = {
  get: {
    tags: ['reports'], summary: 'Reportes de comercio', security: admin,
    parameters: [queryParam('merchantId', 'ID del comercio (requerido)', { type: 'string' })],
    responses: { ...ok('Reportes', { reports: [], count: 0 }), ...err401admin },
  },
  post: {
    tags: ['reports'], summary: 'Crear reporte programado', security: admin,
    requestBody: body(['merchantId', 'name', 'type', 'frequency', 'recipients'], {
      merchantId: { type: 'string' }, name: { type: 'string' }, type: { type: 'string' },
      frequency: { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
      format: { type: 'string' }, recipients: { type: 'array', items: { type: 'string' } },
      filters: { type: 'object' },
    }),
    responses: { ...created('Creado', { report: {} }), ...err401admin },
  },
};
p['/api/v1/reports/{id}'] = {
  get: { tags: ['reports'], summary: 'Detalle de reporte', security: admin, parameters: [pathParam('id', 'ID')], responses: { ...ok('Reporte', { report: {} }), ...err401admin } },
  delete: { tags: ['reports'], summary: 'Eliminar reporte', security: admin, parameters: [pathParam('id', 'ID')], responses: { ...ok('Eliminado', { message: 'ok' }), ...err401admin } },
};
p['/api/v1/reports/{id}/update'] = {
  post: {
    tags: ['reports'], summary: 'Actualizar reporte', security: admin,
    parameters: [pathParam('id', 'ID')],
    requestBody: body([], { name: { type: 'string' }, frequency: { type: 'string' }, recipients: { type: 'array', items: { type: 'string' } }, active: { type: 'boolean' } }),
    responses: { ...ok('Actualizado', { report: {} }), ...err401admin },
  },
};
p['/api/v1/reports/{id}/executions'] = {
  get: { tags: ['reports'], summary: 'Historial de ejecuciones', security: admin, parameters: [pathParam('id', 'ID')], responses: { ...ok('Ejecuciones', { executions: [], count: 0 }), ...err401admin } },
};

// ══════════════════════════════════════════════════
// COMPLIANCE (admin)
// ══════════════════════════════════════════════════
p['/api/v1/compliance'] = {
  get: {
    tags: ['compliance'], summary: 'Log de cumplimiento', security: admin,
    parameters: [{ $ref: '#/components/parameters/limitParam' }],
    responses: { ...ok('Entries', { entries: [], count: 0 }), ...err401admin },
  },
};
p['/api/v1/compliance/stats'] = {
  get: { tags: ['compliance'], summary: 'Estadísticas de cumplimiento', security: admin, responses: { ...ok('Stats', { stats: { total: 0, pending: 0 } }), ...err401admin } },
};
p['/api/v1/compliance/user/{userId}'] = {
  get: {
    tags: ['compliance'], summary: 'Compliance por usuario', security: admin,
    parameters: [pathParam('userId', 'ID del usuario'), { $ref: '#/components/parameters/limitParam' }],
    responses: { ...ok('Entries', { entries: [], count: 0 }), ...err401admin },
  },
};
p['/api/v1/compliance/{entryId}/review'] = {
  post: {
    tags: ['compliance'], summary: 'Marcar entrada como revisada', security: admin,
    parameters: [pathParam('entryId', 'ID de la entrada')],
    requestBody: body(['userId'], { userId: { type: 'string' } }),
    responses: { ...ok('Revisada', { message: 'ok' }), ...err401admin },
  },
};

// ══════════════════════════════════════════════════
// FEES (admin)
// ══════════════════════════════════════════════════
p['/api/v1/fees/defaults'] = {
  get: { tags: ['fees'], summary: 'Comisiones por defecto', security: admin, responses: { ...ok('Defaults', { defaults: {} }), ...err401admin } },
};
p['/api/v1/fees/merchant/{merchantId}'] = {
  get: { tags: ['fees'], summary: 'Comisiones de comercio', security: admin, parameters: [pathParam('merchantId', 'ID')], responses: { ...ok('Config', { config: {} }), ...err401admin } },
  post: {
    tags: ['fees'], summary: 'Configurar comisiones de comercio', security: admin,
    parameters: [pathParam('merchantId', 'ID')],
    requestBody: body(['rules'], { rules: { type: 'object' } }),
    responses: { ...ok('Configurado', { config: {} }), ...err401admin },
  },
  delete: { tags: ['fees'], summary: 'Eliminar comisiones de comercio', security: admin, parameters: [pathParam('merchantId', 'ID')], responses: { ...ok('Eliminado', { ok: true }), ...err401admin } },
};
p['/api/v1/fees/calculate'] = {
  post: {
    tags: ['fees'], summary: 'Calcular comisión', security: admin,
    requestBody: body(['amount', 'method'], { merchantId: { type: 'string' }, amount: { type: 'integer' }, method: { type: 'string' } }),
    responses: { ...ok('Cálculo', { calculation: {} }), ...err401admin },
  },
};

// ══════════════════════════════════════════════════
// SETTLEMENTS (admin)
// ══════════════════════════════════════════════════
p['/api/v1/settlements/merchant/{merchantId}'] = {
  get: { tags: ['settlements'], summary: 'Listar liquidaciones', security: admin, parameters: [pathParam('merchantId', 'ID')], responses: { ...ok('Liquidaciones', { settlements: [] }), ...err401admin } },
};
p['/api/v1/settlements/config/{merchantId}'] = {
  get: { tags: ['settlements'], summary: 'Configuración de liquidación', security: admin, parameters: [pathParam('merchantId', 'ID')], responses: { ...ok('Config', { config: {} }), ...err401admin } },
};
p['/api/v1/settlements/merchant/{merchantId}/summary'] = {
  get: { tags: ['settlements'], summary: 'Resumen pendiente', security: admin, parameters: [pathParam('merchantId', 'ID')], responses: { ...ok('Resumen', { summary: {} }), ...err401admin } },
};
p['/api/v1/settlements/{id}'] = {
  get: { tags: ['settlements'], summary: 'Detalle de liquidación', security: admin, parameters: [pathParam('id', 'ID')], responses: { ...ok('Detalle', { settlement: {} }), ...err401admin } },
};
p['/api/v1/settlements/config'] = {
  post: {
    tags: ['settlements'], summary: 'Configurar liquidación', security: admin,
    requestBody: body(['merchantId', 'frequency', 'bankName', 'accountNumber', 'accountType', 'holderName', 'holderRut'], {
      merchantId: { type: 'string' }, frequency: { type: 'string' },
      bankName: { type: 'string' }, accountNumber: { type: 'string' },
      accountType: { type: 'string' }, holderName: { type: 'string' }, holderRut: { type: 'string' },
    }),
    responses: { ...ok('Configurado', { config: {} }), ...err401admin },
  },
};
p['/api/v1/settlements'] = {
  post: {
    tags: ['settlements'], summary: 'Crear liquidación', security: admin,
    requestBody: body(['merchantId', 'amount', 'fee', 'transactionCount', 'periodStart', 'periodEnd'], {
      merchantId: { type: 'string' }, amount: { type: 'integer' }, fee: { type: 'integer' },
      transactionCount: { type: 'integer' }, periodStart: { type: 'string' }, periodEnd: { type: 'string' },
    }),
    responses: { ...created('Creada', { settlement: {} }), ...err401admin },
  },
};
p['/api/v1/settlements/{id}/process'] = {
  post: {
    tags: ['settlements'], summary: 'Procesar liquidación', security: admin,
    parameters: [pathParam('id', 'ID')],
    requestBody: body(['transferReference'], { transferReference: { type: 'string' } }),
    responses: { ...ok('Procesada', { settlement: {} }), ...err401admin },
  },
};
p['/api/v1/settlements/{id}/cancel'] = {
  post: {
    tags: ['settlements'], summary: 'Cancelar liquidación', security: admin,
    parameters: [pathParam('id', 'ID')],
    requestBody: body(['reason'], { reason: { type: 'string' } }),
    responses: { ...ok('Cancelada', { settlement: {} }), ...err401admin },
  },
};

// ══════════════════════════════════════════════════
// ANALYTICS (admin)
// ══════════════════════════════════════════════════
p['/api/v1/analytics/daily'] = {
  get: {
    tags: ['analytics'], summary: 'Estadísticas diarias', security: admin,
    parameters: [
      queryParam('startDate', 'Fecha inicio (YYYY-MM-DD)', { type: 'string', format: 'date' }),
      queryParam('endDate', 'Fecha fin (YYYY-MM-DD)', { type: 'string', format: 'date' }),
    ],
    responses: { ...ok('Stats', { stats: [] }), ...err401admin },
  },
};
p['/api/v1/analytics/active-users'] = {
  get: { tags: ['analytics'], summary: 'Usuarios activos', security: admin, responses: { ...ok('Counts', { counts: {} }), ...err401admin } },
};
p['/api/v1/analytics/user/{userId}/insights'] = {
  get: {
    tags: ['analytics'], summary: 'Insights de usuario', security: admin,
    parameters: [pathParam('userId', 'ID')],
    responses: { ...ok('Insights', { insights: {} }), ...err401admin },
  },
};

// ══════════════════════════════════════════════════
// EXPORTS (admin)
// ══════════════════════════════════════════════════
p['/api/v1/exports'] = {
  post: {
    tags: ['exports'], summary: 'Crear job de exportación', security: admin,
    requestBody: body(['requestedBy', 'format'], {
      requestedBy: { type: 'string' }, format: { type: 'string', enum: ['csv', 'json'] },
      filters: { type: 'object' },
    }),
    responses: { ...created('Creado', { job: {} }), ...err401admin },
  },
};
p['/api/v1/exports/columns'] = {
  get: { tags: ['exports'], summary: 'Columnas exportables', security: admin, responses: { ...ok('Columnas', { columns: [] }), ...err401admin } },
};
p['/api/v1/exports/user/{userId}'] = {
  get: {
    tags: ['exports'], summary: 'Jobs de exportación de usuario', security: admin,
    parameters: [pathParam('userId', 'ID')],
    responses: { ...ok('Jobs', { jobs: [] }), ...err401admin },
  },
};
p['/api/v1/exports/{id}'] = {
  get: { tags: ['exports'], summary: 'Detalle de job', security: admin, parameters: [pathParam('id', 'ID')], responses: { ...ok('Job', { job: {} }), ...err401admin } },
};

// ══════════════════════════════════════════════════
// MERCHANT ANALYTICS (admin)
// ══════════════════════════════════════════════════
p['/api/v1/merchant-analytics/{merchantId}/{period}/{periodKey}'] = {
  get: {
    tags: ['merchant-analytics'], summary: 'Métricas de comercio', security: admin,
    parameters: [pathParam('merchantId', 'ID'), pathParam('period', 'daily/weekly/monthly'), pathParam('periodKey', 'e.g. 2026-04-01')],
    responses: { ...ok('Métricas', { metrics: {} }), ...err401admin },
  },
};
p['/api/v1/merchant-analytics/{merchantId}/trend'] = {
  get: {
    tags: ['merchant-analytics'], summary: 'Tendencia de métrica', security: admin,
    parameters: [
      pathParam('merchantId', 'ID'),
      queryParam('period', 'Período', { type: 'string' }),
      queryParam('metric', 'Métrica', { type: 'string' }),
      queryParam('limit', 'Límite', { type: 'integer' }),
    ],
    responses: { ...ok('Trend', { trend: [] }), ...err401admin },
  },
};
p['/api/v1/merchant-analytics/{merchantId}/performance'] = {
  get: {
    tags: ['merchant-analytics'], summary: 'Comparación de rendimiento', security: admin,
    parameters: [
      pathParam('merchantId', 'ID'),
      queryParam('period', 'Período', { type: 'string' }),
      queryParam('currentPeriodKey', 'Período actual', { type: 'string' }),
      queryParam('previousPeriodKey', 'Período anterior', { type: 'string' }),
    ],
    responses: { ...ok('Performance', { performance: {} }), ...err401admin },
  },
};
p['/api/v1/merchant-analytics/{merchantId}/periods'] = {
  get: {
    tags: ['merchant-analytics'], summary: 'Períodos disponibles', security: admin,
    parameters: [pathParam('merchantId', 'ID'), queryParam('period', 'Tipo', { type: 'string' })],
    responses: { ...ok('Períodos', { periods: [] }), ...err401admin },
  },
};

// ══════════════════════════════════════════════════
// MERCHANT WEBHOOKS (admin)
// ══════════════════════════════════════════════════
p['/api/v1/merchant-webhooks'] = {
  post: {
    tags: ['merchant-webhooks'], summary: 'Registrar webhook', security: admin,
    requestBody: body(['merchantId', 'url', 'events'], {
      merchantId: { type: 'string' }, url: { type: 'string', format: 'uri' },
      events: { type: 'array', items: { type: 'string' } }, description: { type: 'string' },
    }),
    responses: { ...created('Registrado', { webhook: {} }), ...err401admin },
  },
};
p['/api/v1/merchant-webhooks/merchant/{merchantId}'] = {
  get: {
    tags: ['merchant-webhooks'], summary: 'Listar webhooks de comercio', security: admin,
    parameters: [pathParam('merchantId', 'ID')],
    responses: { ...ok('Webhooks', { webhooks: [], count: 0 }), ...err401admin },
  },
};
p['/api/v1/merchant-webhooks/{id}'] = {
  get: { tags: ['merchant-webhooks'], summary: 'Detalle de webhook', security: admin, parameters: [pathParam('id', 'ID')], responses: { ...ok('Webhook', { webhook: {} }), ...err401admin } },
  delete: { tags: ['merchant-webhooks'], summary: 'Eliminar webhook', security: admin, parameters: [pathParam('id', 'ID')], responses: { ...ok('Eliminado', { success: true }), ...err401admin } },
};
p['/api/v1/merchant-webhooks/{id}/update'] = {
  post: {
    tags: ['merchant-webhooks'], summary: 'Actualizar webhook', security: admin,
    parameters: [pathParam('id', 'ID')],
    requestBody: body([], { url: { type: 'string' }, events: { type: 'array', items: { type: 'string' } }, description: { type: 'string' }, status: { type: 'string' } }),
    responses: { ...ok('Actualizado', { webhook: {} }), ...err401admin },
  },
};
p['/api/v1/merchant-webhooks/{id}/rotate-secret'] = {
  post: { tags: ['merchant-webhooks'], summary: 'Rotar secreto', security: admin, parameters: [pathParam('id', 'ID')], responses: { ...ok('Rotado', {}), ...err401admin } },
};
p['/api/v1/merchant-webhooks/{id}/deliveries'] = {
  get: {
    tags: ['merchant-webhooks'], summary: 'Historial de entregas', security: admin,
    parameters: [pathParam('id', 'ID'), { $ref: '#/components/parameters/limitParam' }],
    responses: { ...ok('Entregas', { deliveries: [], count: 0 }), ...err401admin },
  },
};
p['/api/v1/merchant-webhooks/{id}/stats'] = {
  get: { tags: ['merchant-webhooks'], summary: 'Estadísticas de entrega', security: admin, parameters: [pathParam('id', 'ID')], responses: { ...ok('Stats', { stats: {} }), ...err401admin } },
};

// ══════════════════════════════════════════════════
// CONTACTS
// ══════════════════════════════════════════════════
p['/api/v1/contacts'] = {
  get: { tags: ['contacts'], summary: 'Listar contactos', security: jwt, responses: { ...ok('Contactos', { contacts: [], count: 0 }), ...err401 } },
  post: {
    tags: ['contacts'], summary: 'Agregar contacto', security: jwt,
    requestBody: body(['userId', 'waId', 'name'], { userId: { type: 'string' }, waId: { type: 'string' }, name: { type: 'string' }, alias: { type: 'string' } }),
    responses: { ...ok('Agregado', { message: 'ok' }), ...err400, ...err401 },
  },
};
p['/api/v1/contacts/{contactUserId}'] = {
  delete: { tags: ['contacts'], summary: 'Eliminar contacto', security: jwt, parameters: [pathParam('contactUserId', 'ID')], responses: { ...ok('Eliminado', { deleted: true }), ...err401 } },
};
p['/api/v1/contacts/search'] = {
  get: {
    tags: ['contacts'], summary: 'Buscar contacto por teléfono', security: jwt,
    parameters: [queryParam('phone', 'Teléfono (requerido)', { type: 'string' })],
    responses: { ...ok('Resultado', { contact: {} }), ...err401 },
  },
};

// ══════════════════════════════════════════════════
// ACTIVITY (admin)
// ══════════════════════════════════════════════════
p['/api/v1/activity/user/{userId}'] = {
  get: {
    tags: ['activity'], summary: 'Actividad de usuario', security: admin,
    parameters: [pathParam('userId', 'ID')],
    responses: { ...ok('Actividad', { activity: {} }), ...err401admin },
  },
};

// ══════════════════════════════════════════════════
// API KEYS (admin)
// ══════════════════════════════════════════════════
p['/api/v1/api-keys'] = {
  post: {
    tags: ['api-keys'], summary: 'Crear API key', security: admin,
    requestBody: body(['merchantId', 'name', 'permissions'], {
      merchantId: { type: 'string' }, name: { type: 'string' },
      permissions: { type: 'array', items: { type: 'string' } },
    }),
    responses: { ...created('Creada', { key: {} }), ...err401admin },
  },
};
p['/api/v1/api-keys/merchant/{merchantId}'] = {
  get: {
    tags: ['api-keys'], summary: 'Listar API keys de comercio', security: admin,
    parameters: [pathParam('merchantId', 'ID')],
    responses: { ...ok('Keys', { keys: [], count: 0 }), ...err401admin },
  },
};
p['/api/v1/api-keys/{keyId}'] = {
  delete: {
    tags: ['api-keys'], summary: 'Revocar API key', security: admin,
    parameters: [pathParam('keyId', 'ID del key'), queryParam('merchantId', 'ID del comercio (requerido)', { type: 'string' })],
    responses: { ...ok('Revocada', { deleted: true }), ...err401admin },
  },
};

// ══════════════════════════════════════════════════
// CURRENCY
// ══════════════════════════════════════════════════
p['/api/v1/currency/supported'] = {
  get: { tags: ['currency'], summary: 'Monedas soportadas', security: none, responses: ok('Monedas', { currencies: ['CLP', 'USD'] }) },
};
p['/api/v1/currency/rates'] = {
  get: { tags: ['currency'], summary: 'Tasas de cambio', security: none, responses: ok('Tasas', { rates: { CLP_USD: 0.0011 } }) },
};
p['/api/v1/currency/convert'] = {
  get: {
    tags: ['currency'], summary: 'Convertir moneda', security: none,
    parameters: [
      queryParam('from', 'Moneda origen', { type: 'string' }),
      queryParam('to', 'Moneda destino', { type: 'string' }),
      queryParam('amount', 'Monto', { type: 'number' }),
    ],
    responses: ok('Resultado', { result: {} }),
  },
};

// ══════════════════════════════════════════════════
// NOTIFICATION PREFS
// ══════════════════════════════════════════════════
p['/api/v1/notification-prefs'] = {
  get: { tags: ['notification-prefs'], summary: 'Obtener preferencias de notificación', security: jwt, responses: { ...ok('Prefs', { prefs: {} }), ...err401 } },
  post: {
    tags: ['notification-prefs'], summary: 'Actualizar preferencias de notificación', security: jwt,
    requestBody: body([], { enabled: { type: 'boolean' }, quietHoursEnabled: { type: 'boolean' }, quietStart: { type: 'string' }, quietEnd: { type: 'string' } }),
    responses: { ...ok('Actualizado', { prefs: {} }), ...err401 },
  },
};

// ══════════════════════════════════════════════════
// RECEIPTS
// ══════════════════════════════════════════════════
p['/api/v1/receipts'] = {
  get: { tags: ['receipts'], summary: 'Listar comprobantes', security: jwt, responses: { ...ok('Comprobantes', { receipts: [], count: 0 }), ...err401 } },
};
p['/api/v1/receipts/search'] = {
  get: {
    tags: ['receipts'], summary: 'Buscar por referencia', security: jwt,
    parameters: [queryParam('ref', 'Referencia (requerido)', { type: 'string' })],
    responses: { ...ok('Comprobante', { receipt: {} }), ...err401 },
  },
};
p['/api/v1/receipts/{id}'] = {
  get: { tags: ['receipts'], summary: 'Detalle de comprobante', security: jwt, parameters: [pathParam('id', 'ID')], responses: { ...ok('Comprobante', { receipt: {} }), ...err401 } },
};

// ══════════════════════════════════════════════════
// SUBSCRIPTIONS (recurring payments)
// ══════════════════════════════════════════════════
p['/api/v1/subscriptions'] = {
  get: { tags: ['subscriptions'], summary: 'Listar suscripciones', security: jwt, responses: { ...ok('Suscripciones', { plans: [], count: 0 }), ...err401 } },
  post: {
    tags: ['subscriptions'], summary: 'Crear suscripción (admin)', security: admin,
    requestBody: body(['merchantId', 'subscriberId', 'amount', 'frequency', 'description'], {
      merchantId: { type: 'string' }, subscriberId: { type: 'string' }, amount: { type: 'integer' },
      frequency: { type: 'string', enum: ['weekly', 'biweekly', 'monthly'] }, description: { type: 'string' },
    }),
    responses: { ...created('Creada', { plan: {} }), ...err401admin },
  },
};
p['/api/v1/subscriptions/{id}'] = {
  get: { tags: ['subscriptions'], summary: 'Detalle de suscripción', security: jwt, parameters: [pathParam('id', 'ID')], responses: { ...ok('Suscripción', { plan: {} }), ...err401 } },
};
p['/api/v1/subscriptions/{id}/pause'] = {
  post: { tags: ['subscriptions'], summary: 'Pausar suscripción', security: jwt, parameters: [pathParam('id', 'ID')], responses: { ...ok('Pausada', { plan: {} }), ...err401 } },
};
p['/api/v1/subscriptions/{id}/resume'] = {
  post: { tags: ['subscriptions'], summary: 'Reanudar suscripción', security: jwt, parameters: [pathParam('id', 'ID')], responses: { ...ok('Reanudada', { plan: {} }), ...err401 } },
};
p['/api/v1/subscriptions/{id}/cancel'] = {
  post: { tags: ['subscriptions'], summary: 'Cancelar suscripción', security: jwt, parameters: [pathParam('id', 'ID')], responses: { ...ok('Cancelada', { plan: {} }), ...err401 } },
};

// ══════════════════════════════════════════════════
// PLATFORM STATUS
// ══════════════════════════════════════════════════
p['/api/v1/platform/info'] = {
  get: { tags: ['platform'], summary: 'Información de la plataforma (público)', security: none, responses: ok('Info', { platform: { status: 'operational', metrics: { totalTests: 1844 } } }) },
};
p['/api/v1/platform/metrics'] = {
  get: { tags: ['platform'], summary: 'Métricas de la plataforma', security: admin, responses: { ...ok('Métricas', { metrics: {} }), ...err401admin } },
};

// ══════════════════════════════════════════════════
// WEBHOOK EVENTS (admin)
// ══════════════════════════════════════════════════
p['/api/v1/webhook-subscriptions'] = {
  post: {
    tags: ['webhook-events'], summary: 'Suscribirse a eventos', security: admin,
    requestBody: body(['url', 'events'], { url: { type: 'string', format: 'uri' }, events: { type: 'array', items: { type: 'string' } } }),
    responses: { ...created('Suscrito', {}), ...err401admin },
  },
  get: { tags: ['webhook-events'], summary: 'Listar suscripciones', security: admin, responses: { ...ok('Suscripciones', { subscriptions: [], count: 0 }), ...err401admin } },
};
p['/api/v1/webhook-subscriptions/{id}'] = {
  delete: { tags: ['webhook-events'], summary: 'Desuscribirse', security: admin, parameters: [pathParam('id', 'ID')], responses: { ...ok('Desuscrito', { message: 'ok' }), ...err401admin } },
};

// ══════════════════════════════════════════════════
// RATE LIMITS (admin)
// ══════════════════════════════════════════════════
p['/api/v1/rate-limits'] = {
  get: { tags: ['rate-limits'], summary: 'Ver configuración de rate limits', security: admin, responses: { ...ok('Limits', { limits: { 'payment:create': {}, 'auth:login': {} } }), ...err401admin } },
};
p['/api/v1/rate-limits/{action}/check'] = {
  post: {
    tags: ['rate-limits'], summary: 'Verificar rate limit', security: admin,
    parameters: [pathParam('action', 'Acción (e.g. payment:create)')],
    requestBody: body(['identifier'], { identifier: { type: 'string' } }),
    responses: { ...ok('Resultado', { result: {} }), ...err401admin },
  },
};
p['/api/v1/rate-limits/{action}/reset'] = {
  post: {
    tags: ['rate-limits'], summary: 'Resetear rate limit', security: admin,
    parameters: [pathParam('action', 'Acción')],
    requestBody: body(['identifier'], { identifier: { type: 'string' } }),
    responses: { ...ok('Reseteado', { message: 'ok' }), ...err401admin },
  },
};
p['/api/v1/rate-limits/{action}/override'] = {
  post: {
    tags: ['rate-limits'], summary: 'Configurar override', security: admin,
    parameters: [pathParam('action', 'Acción')],
    requestBody: body(['maxRequests', 'windowSeconds'], { maxRequests: { type: 'integer' }, windowSeconds: { type: 'integer' } }),
    responses: { ...ok('Configurado', { message: 'ok' }), ...err401admin },
  },
  delete: {
    tags: ['rate-limits'], summary: 'Eliminar override', security: admin,
    parameters: [pathParam('action', 'Acción')],
    responses: { ...ok('Eliminado', { message: 'ok' }), ...err401admin },
  },
};

// ══════════════════════════════════════════════════
// QR PAYMENTS
// ══════════════════════════════════════════════════
p['/api/v1/qr/generate'] = {
  post: {
    tags: ['qr'], summary: 'Generar código QR', security: jwt,
    requestBody: body(['type'], {
      type: { type: 'string', enum: ['static', 'dynamic'] },
      merchantId: { type: 'string' }, amount: { type: 'integer' },
      description: { type: 'string' }, expiresInMinutes: { type: 'integer' },
    }),
    responses: { ...created('QR generado', { qr: { reference: 'AB12CD34' }, qrPayload: '...', scanUrl: '/api/v1/qr/scan/AB12CD34' }), ...err400, ...err401 },
  },
};
p['/api/v1/qr/my'] = {
  get: { tags: ['qr'], summary: 'Mis códigos QR', security: jwt, responses: { ...ok('QR codes', { qrCodes: [], count: 0 }), ...err401 } },
};
p['/api/v1/qr/scan/{reference}'] = {
  get: {
    tags: ['qr'], summary: 'Escanear QR (público)', security: none,
    parameters: [pathParam('reference', 'Referencia del QR (8 chars)')],
    responses: { ...ok('QR info', { qr: {} }), ...err404 },
  },
};
p['/api/v1/qr/{id}/use'] = {
  post: {
    tags: ['qr'], summary: 'Marcar QR como usado', security: jwt,
    parameters: [pathParam('id', 'ID del QR')],
    requestBody: body(['transactionRef'], { transactionRef: { type: 'string' } }),
    responses: { ...ok('Usado', { qr: {} }), ...err401 },
  },
};
p['/api/v1/qr/{id}'] = {
  delete: { tags: ['qr'], summary: 'Cancelar QR', security: jwt, parameters: [pathParam('id', 'ID')], responses: { ...ok('Cancelado', { message: 'ok' }), ...err401 } },
};

// ══════════════════════════════════════════════════
// SPLIT PAYMENTS
// ══════════════════════════════════════════════════
p['/api/v1/splits'] = {
  post: {
    tags: ['splits'], summary: 'Crear split payment', security: jwt,
    description: 'Divide la cuenta entre N+1 participantes (creador + invitados). Máx 20 participantes.',
    requestBody: body(['creatorName', 'description', 'totalAmount', 'splitMethod', 'participants'], {
      creatorName: { type: 'string' }, description: { type: 'string' },
      totalAmount: { type: 'integer', minimum: 1000 },
      splitMethod: { type: 'string', enum: ['equal', 'custom'] },
      participants: { type: 'array', items: { type: 'object', properties: { phone: { type: 'string' }, name: { type: 'string' }, amount: { type: 'integer' } } } },
    }),
    responses: { ...created('Split creado', { split: { id: 'spl_xxx', participants: [] } }), ...err400, ...err401 },
  },
  get: { tags: ['splits'], summary: 'Mis splits', security: jwt, responses: { ...ok('Splits', { splits: [], count: 0 }), ...err401 } },
};
p['/api/v1/splits/{id}'] = {
  get: { tags: ['splits'], summary: 'Detalle de split', security: jwt, parameters: [pathParam('id', 'ID')], responses: { ...ok('Split', { split: {}, summary: {} }), ...err401, ...err404 } },
  delete: { tags: ['splits'], summary: 'Cancelar split', security: jwt, parameters: [pathParam('id', 'ID')], responses: { ...ok('Cancelado', { message: 'ok' }), ...err401 } },
};
p['/api/v1/splits/{id}/pay'] = {
  post: {
    tags: ['splits'], summary: 'Pagar parte del split', security: jwt,
    parameters: [pathParam('id', 'ID')],
    requestBody: body(['phone', 'transactionRef'], { phone: { type: 'string' }, transactionRef: { type: 'string' } }),
    responses: { ...ok('Pagado', { split: {} }), ...err400, ...err401 },
  },
};
p['/api/v1/splits/{id}/decline'] = {
  post: {
    tags: ['splits'], summary: 'Rechazar participación', security: jwt,
    parameters: [pathParam('id', 'ID')],
    requestBody: body(['phone'], { phone: { type: 'string' } }),
    responses: { ...ok('Rechazado', { message: 'ok' }), ...err401 },
  },
};

// ══════════════════════════════════════════════════
// SCHEDULED TRANSFERS
// ══════════════════════════════════════════════════
p['/api/v1/scheduled-transfers'] = {
  post: {
    tags: ['scheduled-transfers'], summary: 'Programar transferencia', security: jwt,
    requestBody: body(['receiverPhone', 'receiverName', 'amount', 'description', 'frequency', 'scheduledDate'], {
      receiverPhone: { type: 'string' }, receiverName: { type: 'string' },
      amount: { type: 'integer', minimum: 100 }, description: { type: 'string' },
      frequency: { type: 'string', enum: ['once', 'weekly', 'biweekly', 'monthly'] },
      scheduledDate: { type: 'string', format: 'date' }, scheduledTime: { type: 'string', example: '09:00' },
    }),
    responses: { ...created('Programada', { transfer: { id: 'stx_xxx', frequency: 'monthly' } }), ...err400, ...err401 },
  },
  get: { tags: ['scheduled-transfers'], summary: 'Mis transferencias programadas', security: jwt, responses: { ...ok('Transfers', { transfers: [], count: 0 }), ...err401 } },
};
p['/api/v1/scheduled-transfers/{id}'] = {
  get: { tags: ['scheduled-transfers'], summary: 'Detalle de transferencia', security: jwt, parameters: [pathParam('id', 'ID')], responses: { ...ok('Transfer', { transfer: {} }), ...err401, ...err404 } },
  delete: { tags: ['scheduled-transfers'], summary: 'Cancelar transferencia', security: jwt, parameters: [pathParam('id', 'ID')], responses: { ...ok('Cancelada', { message: 'ok' }), ...err401 } },
};

// ══════════════════════════════════════════════════
// PAYMENT REQUESTS
// ══════════════════════════════════════════════════
p['/api/v1/payment-requests'] = {
  post: {
    tags: ['payment-requests'], summary: 'Solicitar pago', security: jwt,
    description: 'Crea una solicitud de pago a otro usuario. Auto-expiración en 72h. No se puede solicitar a uno mismo.',
    requestBody: body(['requesterName', 'requesterPhone', 'targetPhone', 'amount', 'description'], {
      requesterName: { type: 'string' }, requesterPhone: { type: 'string' },
      targetPhone: { type: 'string' }, targetName: { type: 'string' },
      amount: { type: 'integer', minimum: 100 }, description: { type: 'string' },
      expiresInHours: { type: 'integer', default: 72 },
    }),
    responses: { ...created('Solicitud creada', { request: { id: 'preq_xxx', status: 'pending' } }), ...err400, ...err401 },
  },
};
p['/api/v1/payment-requests/sent'] = {
  get: { tags: ['payment-requests'], summary: 'Solicitudes enviadas', security: jwt, responses: { ...ok('Sent', { requests: [], count: 0 }), ...err401 } },
};
p['/api/v1/payment-requests/received'] = {
  get: {
    tags: ['payment-requests'], summary: 'Solicitudes recibidas', security: jwt,
    parameters: [queryParam('phone', 'Teléfono (requerido)', { type: 'string' })],
    responses: { ...ok('Received', { requests: [], count: 0 }), ...err401 },
  },
};
p['/api/v1/payment-requests/{id}'] = {
  get: { tags: ['payment-requests'], summary: 'Detalle de solicitud', security: jwt, parameters: [pathParam('id', 'ID')], responses: { ...ok('Request', { request: {} }), ...err401, ...err404 } },
  delete: { tags: ['payment-requests'], summary: 'Cancelar solicitud', security: jwt, parameters: [pathParam('id', 'ID')], responses: { ...ok('Cancelada', { message: 'ok' }), ...err401 } },
};
p['/api/v1/payment-requests/{id}/pay'] = {
  post: {
    tags: ['payment-requests'], summary: 'Pagar solicitud', security: jwt,
    parameters: [pathParam('id', 'ID')],
    requestBody: body(['transactionRef'], { transactionRef: { type: 'string' } }),
    responses: { ...ok('Pagada', { request: {} }), ...err401 },
  },
};
p['/api/v1/payment-requests/{id}/decline'] = {
  post: { tags: ['payment-requests'], summary: 'Rechazar solicitud', security: jwt, parameters: [pathParam('id', 'ID')], responses: { ...ok('Rechazada', { request: {} }), ...err401 } },
};

// ══════════════════════════════════════════════════
// ADMIN (main)
// ══════════════════════════════════════════════════
p['/api/v1/admin/users'] = {
  get: {
    tags: ['admin'], summary: 'Listar usuarios', security: admin,
    parameters: [{ $ref: '#/components/parameters/pageParam' }, { $ref: '#/components/parameters/pageSizeParam' }],
    responses: { ...ok('Usuarios', { users: [], total: 0, page: 1, pageSize: 20 }), ...err401admin },
  },
};
p['/api/v1/admin/users/{id}'] = {
  get: { tags: ['admin'], summary: 'Detalle de usuario', security: admin, parameters: [pathParam('id', 'ID')], responses: { ...ok('Usuario', {}), ...err401admin } },
};
p['/api/v1/admin/users/{id}/ban'] = {
  post: { tags: ['admin'], summary: 'Banear usuario', security: admin, parameters: [pathParam('id', 'ID')], responses: { ...ok('Baneado', { message: 'ok', userId: 'uuid' }), ...err401admin } },
};
p['/api/v1/admin/users/{id}/unban'] = {
  post: { tags: ['admin'], summary: 'Desbanear usuario', security: admin, parameters: [pathParam('id', 'ID')], responses: { ...ok('Desbaneado', { message: 'ok', userId: 'uuid' }), ...err401admin } },
};
p['/api/v1/admin/users/{id}/kyc'] = {
  post: {
    tags: ['admin'], summary: 'Actualizar KYC de usuario', security: admin,
    parameters: [pathParam('id', 'ID')],
    requestBody: body(['level'], { level: { type: 'string', enum: ['BASIC', 'INTERMEDIATE', 'FULL'] } }),
    responses: { ...ok('Actualizado', { message: 'ok', userId: 'uuid' }), ...err401admin },
  },
};
p['/api/v1/admin/transactions'] = {
  get: {
    tags: ['admin'], summary: 'Listar transacciones', security: admin,
    parameters: [
      { $ref: '#/components/parameters/pageParam' }, { $ref: '#/components/parameters/pageSizeParam' },
      queryParam('status', 'Filtrar por estado', { type: 'string' }),
    ],
    responses: { ...ok('Transacciones', { transactions: [], total: 0 }), ...err401admin },
  },
};
p['/api/v1/admin/stats'] = {
  get: { tags: ['admin'], summary: 'Estadísticas globales', security: admin, responses: { ...ok('Stats', { users: 0, transactions: 0, totalVolume: 0 }), ...err401admin } },
};
p['/api/v1/admin/metrics'] = {
  get: { tags: ['admin'], summary: 'Métricas detalladas', security: admin, responses: { ...ok('Métricas', { overview: {}, byMethod: {}, daily: [] }), ...err401admin } },
};
p['/api/v1/admin/transactions/export'] = {
  get: {
    tags: ['admin'], summary: 'Exportar transacciones (CSV)', security: admin,
    parameters: [
      queryParam('status', 'Estado', { type: 'string' }),
      queryParam('from', 'Desde', { type: 'string', format: 'date-time' }),
      queryParam('to', 'Hasta', { type: 'string', format: 'date-time' }),
    ],
    responses: { '200': { description: 'CSV file', content: { 'text/csv': {} } }, ...err401admin },
  },
};
p['/api/v1/admin/audit'] = {
  get: {
    tags: ['admin'], summary: 'Log de auditoría', security: admin,
    parameters: [
      queryParam('userId', 'Filtrar por usuario', { type: 'string' }),
      queryParam('eventType', 'Tipo de evento', { type: 'string' }),
      { $ref: '#/components/parameters/pageParam' }, { $ref: '#/components/parameters/pageSizeParam' },
    ],
    responses: { ...ok('Audit', {}), ...err401admin },
  },
};
p['/api/v1/admin/dlq'] = {
  get: {
    tags: ['admin'], summary: 'Dead letter queue', security: admin,
    parameters: [{ $ref: '#/components/parameters/limitParam' }],
    responses: { ...ok('DLQ', { entries: [], count: 0 }), ...err401admin },
  },
  delete: { tags: ['admin'], summary: 'Limpiar DLQ', security: admin, responses: { ...ok('Limpiado', { message: 'ok', count: 0 }), ...err401admin } },
};
p['/api/v1/admin/users/{id}/activity'] = {
  get: { tags: ['admin'], summary: 'Actividad de usuario (admin)', security: admin, parameters: [pathParam('id', 'ID')], responses: { ...ok('Actividad', {}), ...err401admin } },
};
p['/api/v1/admin/waitlist'] = {
  get: { tags: ['admin'], summary: 'Ver waitlist', security: admin, responses: { ...ok('Waitlist', { count: 0, emails: [] }), ...err401admin } },
};
p['/api/v1/admin/waitlist/{email}'] = {
  delete: {
    tags: ['admin'], summary: 'Eliminar de waitlist', security: admin,
    parameters: [pathParam('email', 'Email')],
    responses: { ...ok('Eliminado', { message: 'ok', email: 'test@test.com' }), ...err401admin },
  },
};
p['/api/v1/admin/waitlist/export'] = {
  get: { tags: ['admin'], summary: 'Exportar waitlist (CSV)', security: admin, responses: { '200': { description: 'CSV file', content: { 'text/csv': {} } }, ...err401admin } },
};
p['/api/v1/admin/compliance'] = {
  get: { tags: ['admin'], summary: 'Compliance global', security: admin, responses: { ...ok('Compliance', {}), ...err401admin } },
};
p['/api/v1/admin/compliance/stats'] = {
  get: { tags: ['admin'], summary: 'Stats de compliance', security: admin, responses: { ...ok('Stats', { stats: { total: 0, pending: 0 } }), ...err401admin } },
};
p['/api/v1/admin/platform/metrics'] = {
  get: { tags: ['admin'], summary: 'Métricas de plataforma (admin)', security: admin, responses: { ...ok('Métricas', { metrics: {} }), ...err401admin } },
};
p['/api/v1/admin/notification-templates'] = {
  get: { tags: ['admin'], summary: 'Plantillas de notificación', security: admin, responses: { ...ok('Templates', { templates: [] }), ...err401admin } },
};
p['/api/v1/admin/rate-limits'] = {
  get: { tags: ['admin'], summary: 'Rate limits (admin view)', security: admin, responses: { ...ok('Limits', { limits: {} }), ...err401admin } },
};

// Payment link shortcut
p['/c/{code}'] = {
  get: {
    tags: ['system'], summary: 'Redirección de link de pago', security: none,
    parameters: [pathParam('code', 'Código corto')],
    responses: { '302': { description: 'Redirige a /api/v1/payments/links/{code}' } },
  },
};

// ── Output ──────────────────────────────────────
console.log(JSON.stringify(spec, null, 2));
