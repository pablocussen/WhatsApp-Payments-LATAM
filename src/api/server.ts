import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { env } from '../config/environment';
import { connectRedis, getRedis, prisma } from '../config/database';
import { createLogger } from '../config/logger';
import { rateLimit } from '../middleware/auth.middleware';
import { errorHandler } from '../middleware/error.middleware';
import { requestId } from '../middleware/request-id.middleware';
import webhookRoutes from './webhook.routes';
import userRoutes from './user.routes';
import paymentRoutes from './payment.routes';
import merchantRoutes from './merchant.routes';
import topupRoutes from './topup.routes';

const log = createLogger('server');
const app = express();

// ─── Security Middleware ────────────────────────────────

app.use(requestId);
app.use(
  helmet({
    hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }),
);
app.use(cors({ origin: env.APP_BASE_URL }));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit(100, 60_000));

// ─── Request Logging ────────────────────────────────────

app.use((req, _res, next) => {
  log.debug(`${req.method} ${req.path}`, {
    ip: req.ip,
    requestId: req.headers['x-request-id'],
    userAgent: req.get('user-agent')?.slice(0, 50),
  });
  next();
});

// ─── Health Check ───────────────────────────────────────

app.get('/health', async (_req, res) => {
  const checks: Record<string, 'ok' | 'error'> = {};

  // Redis ping
  try {
    await getRedis().ping();
    checks.redis = 'ok';
  } catch {
    checks.redis = 'error';
  }

  // DB ping
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = 'ok';
  } catch {
    checks.db = 'error';
  }

  const allOk = Object.values(checks).every((v) => v === 'ok');
  const httpStatus = allOk ? 200 : 503;

  res.status(httpStatus).json({
    status: allOk ? 'ok' : 'degraded',
    service: 'whatpay-api',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
    checks,
  });
});

// ─── API Routes v1 ──────────────────────────────────────

app.use('/api/v1', webhookRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/merchants', merchantRoutes);
app.use('/api/v1/topup', topupRoutes);

// ─── API Docs (Swagger UI via CDN — disabled in production) ─────────────────

// Docs are only served outside production to avoid exposing the API schema
if (env.NODE_ENV !== 'production') {
  app.get('/api/docs/spec', (_req, res) => {
    const specPath = path.join(__dirname, '../../docs/openapi.json');
    if (!fs.existsSync(specPath)) {
      return res.status(404).json({ error: 'OpenAPI spec not found' });
    }
    res.setHeader('Content-Type', 'application/json');
    res.send(fs.readFileSync(specPath, 'utf8'));
  });

  app.get('/api/docs', (_req, res) => {
    const specUrl = `${env.APP_BASE_URL}/api/docs/spec`;
    // Override helmet's CSP to allow unpkg CDN scripts/styles for Swagger UI
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline' https://unpkg.com; " +
        "style-src 'self' 'unsafe-inline' https://unpkg.com; " +
        "img-src 'self' data: https://unpkg.com; " +
        `connect-src 'self' ${env.APP_BASE_URL};`,
    );
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WhatPay API Docs</title>
  <meta name="description" content="WhatPay REST API — Pagos por WhatsApp en Chile">
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
  <style>
    body { margin: 0; }
    .topbar { background: #075E54 !important; }
    .topbar-wrapper .link { font-size: 1.1rem; font-weight: 700; }
    .topbar-wrapper .link::before { content: "WhatPay"; color: #25D366; }
    .topbar-wrapper .link span { display: none; }
    #swagger-ui .info .title { color: #075E54; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '${specUrl}',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
      deepLinking: true,
      tryItOutEnabled: true,
      persistAuthorization: true,
      filter: true,
      tagsSorter: 'alpha',
    });
  </script>
</body>
</html>`);
  });
} // end if (env.NODE_ENV !== 'production')

// ─── Payment Link Landing (public) ──────────────────────

app.get('/c/:code', (req, res) => {
  // In production, serve the PWA payment page
  // For now, redirect to API endpoint
  res.redirect(`/api/v1/payments/links/${req.params.code}`);
});

// ─── Error Handler ──────────────────────────────────────

app.use(errorHandler);

// ─── Start Server ───────────────────────────────────────

async function start() {
  try {
    // Connect to Redis
    await connectRedis();
    log.info('Redis connected');

    // Start HTTP server
    app.listen(env.PORT, () => {
      log.info(`WhatPay API running`, {
        port: env.PORT,
        env: env.NODE_ENV,
        url: `http://localhost:${env.PORT}`,
      });
      log.info(
        'Routes loaded: /health, /api/docs, /api/v1/webhook, /api/v1/users, /api/v1/payments, /api/v1/merchants, /c/:code',
      );
    });
  } catch (err) {
    log.error('Failed to start server', { error: (err as Error).message });
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  start();
}

export default app;
export { start };
