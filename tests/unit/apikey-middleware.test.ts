/**
 * API Key middleware + merchant API routes tests.
 */

const mockValidateKey = jest.fn();
const mockHasPermission = jest.fn().mockReturnValue(true);

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

jest.mock('../../src/services/api-key.service', () => ({
  apiKeys: {
    validateKey: (...args: unknown[]) => mockValidateKey(...args),
    hasPermission: (...args: unknown[]) => mockHasPermission(...args),
  },
  ApiKeyService: jest.fn(),
}));

import { startTestServer, type TestClient } from './http-test-client';

let client: TestClient;

const sampleKey = {
  id: 'key-001',
  name: 'Test Key',
  keyPrefix: 'wp_live_abc123',
  keyHash: 'hash',
  merchantId: 'merchant-001',
  permissions: ['transactions:read', 'links:read', 'links:write', 'payments:write'],
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
});

describe('Merchant API (API Key auth)', () => {
  // ── Auth ───────────────────────────────────────────

  it('rejects request without API key', async () => {
    const res = await client.get('/api/v1/merchant-api/me');
    expect(res.status).toBe(401);
    expect((res.body as { error: string }).error).toContain('API key requerida');
  });

  it('rejects invalid API key format', async () => {
    const res = await client.get('/api/v1/merchant-api/me', {
      headers: { 'X-Api-Key': 'invalid-key' },
    });
    expect(res.status).toBe(401);
    expect((res.body as { error: string }).error).toContain('Formato');
  });

  it('rejects revoked/invalid API key', async () => {
    mockValidateKey.mockResolvedValue(null);
    const res = await client.get('/api/v1/merchant-api/me', {
      headers: { 'X-Api-Key': 'wp_live_000000000000000000000000000000000000000000000000' },
    });
    expect(res.status).toBe(401);
    expect((res.body as { error: string }).error).toContain('inválida');
  });

  it('rejects request with insufficient permissions', async () => {
    mockHasPermission.mockReturnValue(false);
    const res = await client.get('/api/v1/merchant-api/transactions', {
      headers: { 'X-Api-Key': 'wp_live_validkey123456789012345678901234567890abcdef' },
    });
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toContain('Permiso insuficiente');
  });

  // ── GET /merchant-api/me ──────────────────────────

  it('returns merchant and key info', async () => {
    const res = await client.get('/api/v1/merchant-api/me', {
      headers: { 'X-Api-Key': 'wp_live_validkey123456789012345678901234567890abcdef' },
    });
    expect(res.status).toBe(200);
    const body = res.body as { merchantId: string; apiKey: { id: string; permissions: string[] } };
    expect(body.merchantId).toBe('merchant-001');
    expect(body.apiKey.id).toBe('key-001');
    expect(body.apiKey.permissions).toContain('transactions:read');
  });

  // ── GET /merchant-api/transactions ────────────────

  it('returns merchant transactions', async () => {
    const res = await client.get('/api/v1/merchant-api/transactions', {
      headers: { 'X-Api-Key': 'wp_live_validkey123456789012345678901234567890abcdef' },
    });
    expect(res.status).toBe(200);
    const body = res.body as { merchantId: string };
    expect(body.merchantId).toBe('merchant-001');
  });

  // ── GET /merchant-api/links ───────────────────────

  it('returns merchant payment links (auth passes)', async () => {
    const res = await client.get('/api/v1/merchant-api/links', {
      headers: { 'X-Api-Key': 'wp_live_validkey123456789012345678901234567890abcdef' },
    });
    // Auth passes (not 401/403). Service may error on mock data.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  // ── POST /merchant-api/links ──────────────────────

  it('creates payment link via API key (auth passes)', async () => {
    const res = await client.post('/api/v1/merchant-api/links', {
      headers: { 'X-Api-Key': 'wp_live_validkey123456789012345678901234567890abcdef' },
      body: { amount: 15000, description: 'Test charge' },
    });
    // Auth passes (not 401/403). Service may error on mock data.
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  // ── DELETE /merchant-api/links/:id ────────────────

  it('deactivates payment link via API key (auth passes)', async () => {
    const res = await client.delete('/api/v1/merchant-api/links/link-001', {
      headers: { 'X-Api-Key': 'wp_live_validkey123456789012345678901234567890abcdef' },
    });
    // Auth passes (not 401/403)
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });

  // ── POST /merchant-api/charge ─────────────────────

  it('rejects charge without required fields', async () => {
    const res = await client.post('/api/v1/merchant-api/charge', {
      headers: { 'X-Api-Key': 'wp_live_validkey123456789012345678901234567890abcdef' },
      body: {},
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toContain('requeridos');
  });

  it('rejects charge with amount out of range', async () => {
    const res = await client.post('/api/v1/merchant-api/charge', {
      headers: { 'X-Api-Key': 'wp_live_validkey123456789012345678901234567890abcdef' },
      body: { payerId: 'user-1', amount: 50 },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toContain('Monto');
  });
});
