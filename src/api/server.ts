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
import adminRoutes from './admin.routes';
import waitlistRoutes from './waitlist.routes';
import referralRoutes from './referral.routes';
import loyaltyRoutes from './loyalty.routes';
import promotionsRoutes from './promotions.routes';
import disputeRoutes from './dispute.routes';
import kycRoutes from './kyc.routes';
import merchantOnboardingRoutes from './merchant-onboarding.routes';
import userPrefsRoutes from './user-prefs.routes';
import spendingLimitsRoutes from './spending-limits.routes';
import beneficiaryRoutes from './beneficiary.routes';
import notificationTemplatesRoutes from './notification-templates.routes';
import scheduledReportsRoutes from './scheduled-reports.routes';
import complianceRoutes from './compliance.routes';
import feeConfigRoutes from './fee-config.routes';
import settlementRoutes from './settlement.routes';
import analyticsRoutes from './analytics.routes';
import transactionExportRoutes from './transaction-export.routes';
import merchantAnalyticsRoutes from './merchant-analytics.routes';
import merchantWebhookRoutes from './merchant-webhook.routes';
import contactsRoutes from './contacts.routes';
import activityRoutes from './activity.routes';
import apiKeyRoutes from './api-key.routes';
import currencyRoutes from './currency.routes';
import notificationPrefsRoutes from './notification-prefs.routes';
import receiptRoutes from './receipt.routes';
import recurringPaymentRoutes from './recurring-payment.routes';
import platformStatusRoutes from './platform-status.routes';
import webhookEventsRoutes from './webhook-events.routes';
import rateLimitRoutes from './rate-limit.routes';
import qrPaymentRoutes from './qr-payment.routes';
import splitPaymentRoutes from './split-payment.routes';
import scheduledTransferRoutes from './scheduled-transfer.routes';
import paymentRequestRoutes from './payment-request.routes';
import { SchedulerService } from '../services/scheduler.service';
import { metricsMiddleware } from '../middleware/metrics.middleware';

const log = createLogger('server');
const scheduler = new SchedulerService();
const app = express();
const startedAt = new Date();
const pkg = { version: '0.1.0' }; // read once at startup
try { Object.assign(pkg, require('../../package.json')); } catch { /* bundled */ }

// Trust Google Cloud Run / load balancer proxies so req.ip reflects the real
// client IP address (from X-Forwarded-For) rather than the proxy's IP.
// Required for correct per-IP rate limiting in production.
app.set('trust proxy', 1);

// ─── Security Middleware ────────────────────────────────

app.use(requestId);
app.use(
  helmet({
    hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  }),
);
app.use(cors({ origin: [env.APP_BASE_URL, 'https://cussen.cl', 'https://cussen-46735.web.app'] }));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit(100, 60_000));
app.use(metricsMiddleware);

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

app.get('/', (_req, res) => {
  res.json({
    service: 'whatpay-api',
    version: pkg.version,
    status: 'ok',
    docs: '/api/docs',
    health: '/health',
  });
});

app.get('/health', async (_req, res) => {
  const checks: Record<string, { status: 'ok' | 'error'; latencyMs?: number }> = {};

  // Redis ping
  const redisStart = Date.now();
  try {
    await getRedis().ping();
    checks.redis = { status: 'ok', latencyMs: Date.now() - redisStart };
  } catch {
    checks.redis = { status: 'error', latencyMs: Date.now() - redisStart };
  }

  // DB ping
  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.db = { status: 'ok', latencyMs: Date.now() - dbStart };
  } catch {
    checks.db = { status: 'error', latencyMs: Date.now() - dbStart };
  }

  const allOk = Object.values(checks).every((v) => v.status === 'ok');
  const httpStatus = allOk ? 200 : 503;

  const uptimeMs = Date.now() - startedAt.getTime();
  const uptimeH = Math.floor(uptimeMs / 3_600_000);
  const uptimeM = Math.floor((uptimeMs % 3_600_000) / 60_000);

  res.status(httpStatus).json({
    status: allOk ? 'ok' : 'degraded',
    service: 'whatpay-api',
    version: pkg.version,
    timestamp: new Date().toISOString(),
    uptime: `${uptimeH}h ${uptimeM}m`,
    startedAt: startedAt.toISOString(),
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
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1', waitlistRoutes);
app.use('/api/v1', referralRoutes);
app.use('/api/v1', loyaltyRoutes);
app.use('/api/v1', promotionsRoutes);
app.use('/api/v1', disputeRoutes);
app.use('/api/v1', kycRoutes);
app.use('/api/v1', merchantOnboardingRoutes);
app.use('/api/v1', userPrefsRoutes);
app.use('/api/v1', spendingLimitsRoutes);
app.use('/api/v1', beneficiaryRoutes);
app.use('/api/v1', notificationTemplatesRoutes);
app.use('/api/v1', scheduledReportsRoutes);
app.use('/api/v1', complianceRoutes);
app.use('/api/v1', feeConfigRoutes);
app.use('/api/v1', settlementRoutes);
app.use('/api/v1', analyticsRoutes);
app.use('/api/v1', transactionExportRoutes);
app.use('/api/v1', merchantAnalyticsRoutes);
app.use('/api/v1', merchantWebhookRoutes);
app.use('/api/v1', contactsRoutes);
app.use('/api/v1', activityRoutes);
app.use('/api/v1', apiKeyRoutes);
app.use('/api/v1', currencyRoutes);
app.use('/api/v1', notificationPrefsRoutes);
app.use('/api/v1', receiptRoutes);
app.use('/api/v1', recurringPaymentRoutes);
app.use('/api/v1', platformStatusRoutes);
app.use('/api/v1', webhookEventsRoutes);
app.use('/api/v1', rateLimitRoutes);
app.use('/api/v1', qrPaymentRoutes);
app.use('/api/v1', splitPaymentRoutes);
app.use('/api/v1', scheduledTransferRoutes);
app.use('/api/v1', paymentRequestRoutes);

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

    // Start scheduled jobs (link cleanup, stale tx pruning)
    scheduler.start();

    // Start HTTP server
    const server = app.listen(env.PORT, () => {
      log.info(`WhatPay API running`, {
        port: env.PORT,
        env: env.NODE_ENV,
        url: `http://localhost:${env.PORT}`,
      });
      log.info(
        'Routes loaded: /health, /api/docs, /api/v1/webhook, /api/v1/users, /api/v1/payments, /api/v1/merchants, /c/:code',
      );
    });

    // ─── Graceful Shutdown ───────────────────────────────
    // Cloud Run sends SIGTERM before terminating the container.
    // We stop accepting new connections, wait for in-flight requests,
    // then disconnect from DB and Redis cleanly.
    const shutdown = (signal: string) => {
      log.info(`Received ${signal} — shutting down gracefully`);
      scheduler.stop();
      server.close(async () => {
        try {
          await prisma.$disconnect();
          log.info('Database disconnected');
          const redis = getRedis();
          await redis.quit();
          log.info('Redis disconnected');
        } catch (err) {
          log.warn('Error during shutdown cleanup', { error: (err as Error).message });
        }
        log.info('Shutdown complete');
        process.exit(0);
      });
      // Force exit if graceful shutdown takes longer than 9s (Cloud Run limit is 10s)
      setTimeout(() => {
        log.error('Graceful shutdown timed out — forcing exit');
        process.exit(1);
      }, 9_000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
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
