/**
 * Route-level tests for merchant-webhook.routes.ts
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisIncr = jest.fn().mockResolvedValue(1);

jest.mock('../../src/config/environment', () => ({
  env: {
    NODE_ENV: 'test', JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
    JWT_EXPIRATION: '30m', APP_BASE_URL: 'http://localhost:3000',
    ADMIN_API_KEY: 'test-admin-key-at-least-32-characters-long',
  },
}));

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    incr: (...args: unknown[]) => mockRedisIncr(...args),
    del: jest.fn(), sAdd: jest.fn(), sRem: jest.fn(), sMembers: jest.fn(), sCard: jest.fn(),
    lPush: jest.fn(), lRange: jest.fn().mockResolvedValue([]),
    expire: jest.fn().mockResolvedValue(true), ping: jest.fn().mockResolvedValue('PONG'),
  }),
  connectRedis: jest.fn(),
  prisma: { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) },
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../src/services/scheduler.service', () => ({
  SchedulerService: jest.fn().mockImplementation(() => ({ start: jest.fn(), stop: jest.fn() })),
}));

import { startTestServer, type TestClient } from './http-test-client';
import type { MerchantWebhook } from '../../src/services/merchant-webhook.service';

const ADMIN_KEY = 'test-admin-key-at-least-32-characters-long';
let client: TestClient;

const sampleHook: MerchantWebhook = {
  id: 'wh_test001', merchantId: 'merchant-1', url: 'https://example.com/webhook',
  secret: 'whsec_test123456', events: ['payment.completed'], status: 'active',
  description: null, failureCount: 0, lastDeliveryAt: null, lastFailureAt: null,
  lastFailureReason: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
};

beforeAll(async () => {
  const { default: app } = await import('../../src/api/server');
  client = await startTestServer(app);
});
afterAll(async () => { await client.close(); });
beforeEach(() => {
  jest.clearAllMocks();
  mockRedisGet.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue('OK');
});

describe('POST /api/v1/admin/merchant-webhooks', () => {
  it('registers a webhook', async () => {
    const res = await client.post('/api/v1/admin/merchant-webhooks', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { merchantId: 'merchant-1', url: 'https://example.com/hook', events: ['payment.completed'] },
    });
    expect(res.status).toBe(201);
    const body = res.body as { webhook: MerchantWebhook };
    expect(body.webhook.id).toMatch(/^wh_/);
    expect(body.webhook.secret).toMatch(/^whsec_/);
  });

  it('returns 400 for HTTP url', async () => {
    const res = await client.post('/api/v1/admin/merchant-webhooks', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { merchantId: 'merchant-1', url: 'http://example.com/hook', events: ['payment.completed'] },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for empty events', async () => {
    const res = await client.post('/api/v1/admin/merchant-webhooks', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { merchantId: 'merchant-1', url: 'https://example.com/hook', events: [] },
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.post('/api/v1/admin/merchant-webhooks', {
      body: { merchantId: 'x', url: 'https://x.com', events: ['payment.completed'] },
    });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/admin/merchant-webhooks/merchant/:merchantId', () => {
  it('returns merchant webhooks', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'mwh:merchant:merchant-1') return Promise.resolve(JSON.stringify(['wh_test001']));
      if (key === 'mwh:hook:wh_test001') return Promise.resolve(JSON.stringify(sampleHook));
      return Promise.resolve(null);
    });
    const res = await client.get('/api/v1/admin/merchant-webhooks/merchant/merchant-1', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    expect((res.body as { count: number }).count).toBe(1);
  });
});

describe('GET /api/v1/admin/merchant-webhooks/:id', () => {
  it('returns webhook detail', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(sampleHook));
    const res = await client.get('/api/v1/admin/merchant-webhooks/wh_test001', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    expect((res.body as { webhook: MerchantWebhook }).webhook.id).toBe('wh_test001');
  });

  it('returns 404 for unknown', async () => {
    const res = await client.get('/api/v1/admin/merchant-webhooks/wh_unknown', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/admin/merchant-webhooks/:id/update', () => {
  it('updates status', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(sampleHook));
    const res = await client.post('/api/v1/admin/merchant-webhooks/wh_test001/update', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { status: 'disabled' },
    });
    expect(res.status).toBe(200);
    expect((res.body as { webhook: MerchantWebhook }).webhook.status).toBe('disabled');
  });
});

describe('POST /api/v1/admin/merchant-webhooks/:id/rotate-secret', () => {
  it('rotates secret', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(sampleHook));
    const res = await client.post('/api/v1/admin/merchant-webhooks/wh_test001/rotate-secret', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    const body = res.body as { newSecret: string };
    expect(body.newSecret).toMatch(/^whsec_/);
  });
});

describe('DELETE /api/v1/admin/merchant-webhooks/:id', () => {
  it('soft-deletes webhook', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(sampleHook));
    const res = await client.delete('/api/v1/admin/merchant-webhooks/wh_test001', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
  });

  it('returns 404 for unknown', async () => {
    const res = await client.delete('/api/v1/admin/merchant-webhooks/wh_unknown', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(404);
  });
});
