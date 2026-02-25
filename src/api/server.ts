import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { env } from '../config/environment';
import { connectRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { rateLimit } from '../middleware/auth.middleware';
import { errorHandler } from '../middleware/error.middleware';
import webhookRoutes from './webhook.routes';
import userRoutes from './user.routes';
import paymentRoutes from './payment.routes';
import merchantRoutes from './merchant.routes';
import topupRoutes from './topup.routes';

const log = createLogger('server');
const app = express();

// ─── Security Middleware ────────────────────────────────

app.use(helmet());
app.use(cors({ origin: env.APP_BASE_URL }));
app.use(express.json({ limit: '1mb' }));
app.use(rateLimit(100, 60_000));

// ─── Request Logging ────────────────────────────────────

app.use((req, _res, next) => {
  log.debug(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('user-agent')?.slice(0, 50),
  });
  next();
});

// ─── Health Check ───────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'whatpay-api',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
  });
});

// ─── API Routes v1 ──────────────────────────────────────

app.use('/api/v1', webhookRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/merchants', merchantRoutes);
app.use('/api/v1/topup', topupRoutes);

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
      log.info('Routes loaded: /health, /api/v1/webhook, /api/v1/users, /api/v1/payments, /api/v1/merchants, /c/:code');
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
