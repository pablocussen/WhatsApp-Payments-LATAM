/**
 * Merchant API — Link Template routes tests.
 */

const mockValidateKey = jest.fn();
const mockHasPermission = jest.fn().mockReturnValue(true);
const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');

jest.mock('../../src/config/environment', () => ({
  env: {
    NODE_ENV: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
    JWT_EXPIRATION: '30m',
    APP_BASE_URL: 'http://localhost:3000',
    ADMIN_API_KEY: 'test-admin-key-at-least-32-characters-long',
    PAYMENT_LINK_BASE_URL: 'https://whatpay.cl/pay',
  },
}));

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
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
    paymentLink: {
      create: jest.fn().mockResolvedValue({
        id: 'link_test_001',
        merchantId: 'merchant-001',
        shortCode: 'abc123',
        amount: BigInt(8500),
        description: 'Menu',
        expiresAt: new Date('2026-12-31'),
        maxUses: 1,
        useCount: 0,
        active: true,
        createdAt: new Date(),
        merchant: { name: 'Test Merchant' },
      }),
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
  },
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../src/services/scheduler.service', () => ({
  SchedulerService: jest.fn().mockImplementation(() => ({ start: jest.fn(), stop: jest.fn() })),
}));

jest.mock('../../src/services/api-key.service', () => ({
  apiKeys: {
    validateKey: (...args: unknown[]) => mockValidateKey(...args),
    hasPermission: (...args: unknown[]) => mockHasPermission(...args),
  },
  ApiKeyService: jest.fn(),
}));

import { startTestServer, type TestClient } from './http-test-client';

let client: TestClient;

const API_KEY = 'wp_live_validkey123456789012345678901234567890abcdef';
const sampleKey = {
  id: 'key-001',
  name: 'Test Key',
  keyPrefix: 'wp_live_abc123',
  keyHash: 'hash',
  merchantId: 'merchant-001',
  permissions: ['links:read', 'links:write'],
  createdAt: '2026-01-01T00:00:00Z',
  lastUsedAt: null,
  active: true,
};

beforeAll(async () => {
  const { default: app } = await import('../../src/api/server');
  client = await startTestServer(app);
});
afterAll(async () => { if (client) await client.close(); });
beforeEach(() => {
  jest.clearAllMocks();
  mockValidateKey.mockResolvedValue(sampleKey);
  mockHasPermission.mockReturnValue(true);
  mockRedisGet.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue('OK');
});

describe('Merchant API — Link Templates', () => {
  // ── GET /merchant-api/templates ─────────────────────

  it('returns empty templates list', async () => {
    const res = await client.get('/api/v1/merchant-api/templates', {
      headers: { 'X-Api-Key': API_KEY },
    });
    expect(res.status).toBe(200);
    const body = res.body as { templates: unknown[]; count: number };
    expect(body.templates).toEqual([]);
    expect(body.count).toBe(0);
  });

  it('returns stored templates', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'tpl_1', merchantId: 'merchant-001', name: 'Almuerzo', amount: 8500 },
    ]));
    const res = await client.get('/api/v1/merchant-api/templates', {
      headers: { 'X-Api-Key': API_KEY },
    });
    expect(res.status).toBe(200);
    const body = res.body as { templates: { id: string }[]; count: number };
    expect(body.count).toBe(1);
    expect(body.templates[0].id).toBe('tpl_1');
  });

  // ── POST /merchant-api/templates ────────────────────

  it('creates a template', async () => {
    const res = await client.post('/api/v1/merchant-api/templates', {
      headers: { 'X-Api-Key': API_KEY },
      body: { name: 'Almuerzo', amount: 8500, description: 'Menu del dia' },
    });
    expect(res.status).toBe(201);
    const body = res.body as { id: string; name: string; amount: number };
    expect(body.id).toMatch(/^tpl_/);
    expect(body.name).toBe('Almuerzo');
    expect(body.amount).toBe(8500);
  });

  it('rejects template without name', async () => {
    const res = await client.post('/api/v1/merchant-api/templates', {
      headers: { 'X-Api-Key': API_KEY },
      body: { amount: 5000 },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toContain('name');
  });

  // ── GET /merchant-api/templates/:id ─────────────────

  it('returns a specific template', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'tpl_1', merchantId: 'merchant-001', name: 'Test', amount: 1000 },
    ]));
    const res = await client.get('/api/v1/merchant-api/templates/tpl_1', {
      headers: { 'X-Api-Key': API_KEY },
    });
    expect(res.status).toBe(200);
    expect((res.body as { id: string }).id).toBe('tpl_1');
  });

  it('returns 404 for non-existent template', async () => {
    const res = await client.get('/api/v1/merchant-api/templates/tpl_nonexistent', {
      headers: { 'X-Api-Key': API_KEY },
    });
    expect(res.status).toBe(404);
  });

  // ── DELETE /merchant-api/templates/:id ──────────────

  it('deletes a template', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'tpl_1', merchantId: 'merchant-001', name: 'Test' },
      { id: 'tpl_2', merchantId: 'merchant-001', name: 'Other' },
    ]));
    const res = await client.delete('/api/v1/merchant-api/templates/tpl_1', {
      headers: { 'X-Api-Key': API_KEY },
    });
    expect(res.status).toBe(200);
    expect((res.body as { message: string }).message).toContain('eliminado');
  });

  it('returns 404 when deleting non-existent template', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([]));
    const res = await client.delete('/api/v1/merchant-api/templates/tpl_nonexistent', {
      headers: { 'X-Api-Key': API_KEY },
    });
    expect(res.status).toBe(404);
  });

  // ── POST /merchant-api/templates/:id/use ────────────

  it('creates a link from template', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      {
        id: 'tpl_1', merchantId: 'merchant-001', name: 'Almuerzo',
        amount: 8500, description: 'Menu', expiresInHours: 24,
        maxUses: null, usageCount: 3,
      },
    ]));
    const res = await client.post('/api/v1/merchant-api/templates/tpl_1/use', {
      headers: { 'X-Api-Key': API_KEY },
    });
    expect(res.status).toBe(201);
    const body = res.body as { link: { id: string }; template: { usageCount: number } };
    expect(body.link.id).toBeDefined();
    expect(body.template.usageCount).toBe(4);
  });

  it('returns 404 when using non-existent template', async () => {
    const res = await client.post('/api/v1/merchant-api/templates/tpl_nonexistent/use', {
      headers: { 'X-Api-Key': API_KEY },
    });
    expect(res.status).toBe(404);
  });

  it('returns 409 when template has reached max uses', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      {
        id: 'tpl_1', merchantId: 'merchant-001', name: 'Limited',
        amount: 5000, maxUses: 3, usageCount: 3, expiresInHours: 24,
      },
    ]));
    const res = await client.post('/api/v1/merchant-api/templates/tpl_1/use', {
      headers: { 'X-Api-Key': API_KEY },
    });
    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toContain('límite');
  });

  // ── Auth ────────────────────────────────────────────

  it('rejects templates access without API key', async () => {
    const res = await client.get('/api/v1/merchant-api/templates');
    expect(res.status).toBe(401);
  });
});
