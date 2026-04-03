/**
 * Legal routes — Terms of Service, Privacy Policy, Commerce Disclaimer.
 */

jest.mock('../../src/config/environment', () => ({
  env: {
    NODE_ENV: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
    JWT_EXPIRATION: '30m',
    APP_BASE_URL: 'http://localhost:3000',
    ADMIN_API_KEY: 'test-admin-key-at-least-32-characters-long',
  },
}));

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    sAdd: jest.fn(), sRem: jest.fn(), sMembers: jest.fn().mockResolvedValue([]),
    sCard: jest.fn().mockResolvedValue(0),
    lPush: jest.fn(), lRange: jest.fn().mockResolvedValue([]), lTrim: jest.fn(),
    expire: jest.fn().mockResolvedValue(true), ping: jest.fn().mockResolvedValue('PONG'),
    zAdd: jest.fn(), zRemRangeByScore: jest.fn(), zCard: jest.fn().mockResolvedValue(0),
    zRange: jest.fn().mockResolvedValue([]),
    multi: jest.fn().mockReturnValue({
      incr: jest.fn().mockReturnThis(), incrBy: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(), del: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(), sAdd: jest.fn().mockReturnThis(),
      lPush: jest.fn().mockReturnThis(), lTrim: jest.fn().mockReturnThis(),
      zRemRangeByScore: jest.fn().mockReturnThis(), zCard: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    }),
  }),
  connectRedis: jest.fn(),
  prisma: {
    user: { findUnique: jest.fn(), count: jest.fn().mockResolvedValue(5), findMany: jest.fn().mockResolvedValue([]) },
    transaction: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }) },
    wallet: { findUnique: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    $transaction: jest.fn(),
  },
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../src/services/scheduler.service', () => ({
  SchedulerService: jest.fn().mockImplementation(() => ({ start: jest.fn(), stop: jest.fn() })),
}));

import { startTestServer, type TestClient } from './http-test-client';

let client: TestClient;

beforeAll(async () => {
  const { default: app } = await import('../../src/api/server');
  client = await startTestServer(app);
});
afterAll(async () => { await client.close(); });

describe('Legal Routes', () => {
  // ── GET /api/v1/legal ──────────────────────────────

  it('returns terms of service', async () => {
    const res = await client.get('/api/v1/legal');
    expect(res.status).toBe(200);
    const body = res.body as {
      termsOfService: { version: string; url: string; summary: string[] };
    };
    expect(body.termsOfService.version).toBe('1.0');
    expect(body.termsOfService.url).toContain('whatpay.cl/legal');
    expect(body.termsOfService.summary.length).toBeGreaterThan(3);
  });

  it('returns privacy policy', async () => {
    const res = await client.get('/api/v1/legal');
    const body = res.body as {
      privacyPolicy: { version: string; url: string; summary: string[] };
    };
    expect(body.privacyPolicy.version).toBe('1.0');
    expect(body.privacyPolicy.url).toContain('whatpay.cl/privacidad');
    expect(body.privacyPolicy.summary.length).toBeGreaterThan(3);
  });

  it('includes commerce disclaimer (not a lender)', async () => {
    const res = await client.get('/api/v1/legal');
    const body = res.body as {
      commerceDisclaimer: { clarifications: string[] };
    };
    const disclaimers = body.commerceDisclaimer.clarifications.join(' ');
    expect(disclaimers).toContain('NO facilita pr');
    expect(disclaimers).toContain('NO opera con monedas virtuales');
    expect(disclaimers).toContain('CLP');
  });

  it('includes data protection rights (Ley 19.628)', async () => {
    const res = await client.get('/api/v1/legal');
    const body = res.body as {
      dataProtection: { law: string; rights: string[]; contact: string };
    };
    expect(body.dataProtection.law).toContain('19.628');
    expect(body.dataProtection.rights.length).toBeGreaterThanOrEqual(4);
    expect(body.dataProtection.contact).toContain('@whatpay.cl');
  });

  it('includes WhatsApp compliance info', async () => {
    const res = await client.get('/api/v1/legal');
    const body = res.body as {
      whatsappCompliance: { optIn: string; optOut: string; escalation: string };
    };
    expect(body.whatsappCompliance.optIn).toBeTruthy();
    expect(body.whatsappCompliance.optOut).toContain('/silenciar');
    expect(body.whatsappCompliance.escalation).toContain('/soporte');
  });

  // ── GET /api/v1/legal/consents ─────────────────────

  it('returns consent info endpoint', async () => {
    const res = await client.get('/api/v1/legal/consents');
    expect(res.status).toBe(200);
    const body = res.body as {
      requiredConsents: string[];
      optionalConsents: string[];
    };
    expect(body.requiredConsents).toContain('tos');
    expect(body.requiredConsents).toContain('privacy');
    expect(body.requiredConsents).toContain('messaging');
    expect(body.optionalConsents).toContain('marketing');
  });
});
