/**
 * Route-level tests for webhook-events.routes.ts.
 * Covers: POST subscribe, GET list, DELETE unsubscribe, admin auth.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisDel = jest.fn().mockResolvedValue(1);
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
    del: (...args: unknown[]) => mockRedisDel(...args),
    incr: (...args: unknown[]) => mockRedisIncr(...args),
    sAdd: jest.fn(), sRem: jest.fn(), sMembers: jest.fn(),
    sCard: jest.fn().mockResolvedValue(0),
    lPush: jest.fn(), lRange: jest.fn().mockResolvedValue([]), lTrim: jest.fn(),
    expire: jest.fn().mockResolvedValue(true), ping: jest.fn().mockResolvedValue('PONG'),
    zAdd: jest.fn().mockResolvedValue(1),
    zRemRangeByScore: jest.fn().mockResolvedValue(0),
    zCard: jest.fn().mockResolvedValue(0),
    zRange: jest.fn().mockResolvedValue([]),
    multi: jest.fn().mockReturnValue({
      incr: jest.fn().mockReturnThis(), incrBy: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis(),
      zRemRangeByScore: jest.fn().mockReturnThis(),
      zCard: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([0, 0]),
    }),
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
const ADMIN_KEY = 'test-admin-key-at-least-32-characters-long';
let client: TestClient;
beforeAll(async () => { const { default: app } = await import('../../src/api/server'); client = await startTestServer(app); });
afterAll(async () => { await client.close(); });
beforeEach(() => { jest.clearAllMocks(); mockRedisGet.mockResolvedValue(null); mockRedisSet.mockResolvedValue('OK'); mockRedisDel.mockResolvedValue(1); });

// ─── Tests ──────────────────────────────────────────────

describe('webhook-events.routes', () => {
  it('POST subscribe returns 201 with id and secret', async () => {
    const res = await client.post('/api/v1/admin/webhook-subscriptions', {
      body: { url: 'https://example.com/hook', events: ['payment.completed', 'user.created'] },
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(201);
    const body = res.body as Record<string, unknown>;
    expect(body.id).toBeDefined();
    expect(body.secret).toBeDefined();
    expect(body.url).toBe('https://example.com/hook');
    expect(body.events).toEqual(['payment.completed', 'user.created']);
  });

  it('POST subscribe returns 400 for missing url', async () => {
    const res = await client.post('/api/v1/admin/webhook-subscriptions', {
      body: { events: ['payment.completed'] },
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(400);
  });

  it('GET list returns subscriptions with count', async () => {
    // First subscribe so there is data
    await client.post('/api/v1/admin/webhook-subscriptions', {
      body: { url: 'https://example.com/hook', events: ['payment.completed'] },
      headers: { 'x-admin-key': ADMIN_KEY },
    });

    const res = await client.get('/api/v1/admin/webhook-subscriptions', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.subscriptions).toBeDefined();
    expect(typeof body.count).toBe('number');
  });

  it('DELETE unsubscribe returns 200', async () => {
    // Mock existing subscription
    const existingSub = { id: 'sub123', url: 'https://example.com/hook', secret: 'abc', events: ['user.created'], active: true, createdAt: new Date().toISOString() };
    mockRedisGet.mockResolvedValue(JSON.stringify([existingSub]));

    const res = await client.delete('/api/v1/admin/webhook-subscriptions/sub123', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
  });

  it('DELETE unsubscribe returns 404 for unknown', async () => {
    const res = await client.delete('/api/v1/admin/webhook-subscriptions/nonexistent', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(404);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.get('/api/v1/admin/webhook-subscriptions');
    expect(res.status).toBe(401);
  });
});
