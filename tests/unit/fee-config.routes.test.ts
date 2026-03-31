/**
 * Route-level tests for fee-config.routes.ts
 * Covers: GET /admin/fees/defaults, GET/POST/DELETE /admin/fees/merchant/:id,
 *         POST /admin/fees/calculate
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
    lPush: jest.fn(), lRange: jest.fn().mockResolvedValue([]),
    expire: jest.fn().mockResolvedValue(true), ping: jest.fn().mockResolvedValue('PONG'),
    multi: jest.fn().mockReturnValue({
      incrBy: jest.fn().mockReturnThis(), incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(), sAdd: jest.fn().mockReturnThis(),
      del: jest.fn().mockReturnThis(), lPush: jest.fn().mockReturnThis(),
      lTrim: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
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
import type { FeeRule, FeeConfig, FeeCalculation } from '../../src/services/fee-config.service';

const ADMIN_KEY = 'test-admin-key-at-least-32-characters-long';
let client: TestClient;

const sampleRule: FeeRule = {
  method: 'WALLET',
  percentFee: 0,
  fixedFee: 0,
  minFee: 0,
  maxFee: 0,
};

const sampleConfig: FeeConfig = {
  merchantId: 'merchant-1',
  rules: [sampleRule],
  updatedAt: new Date().toISOString(),
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
  mockRedisDel.mockResolvedValue(1);
});

// ─── GET /api/v1/admin/fees/defaults ──────────────────────

describe('GET /api/v1/admin/fees/defaults', () => {
  it('returns platform default fee rules', async () => {
    const res = await client.get('/api/v1/admin/fees/defaults', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    const body = res.body as { defaults: FeeRule[] };
    expect(Array.isArray(body.defaults)).toBe(true);
    expect(body.defaults.length).toBeGreaterThanOrEqual(4);
    expect(body.defaults[0]).toHaveProperty('method');
    expect(body.defaults[0]).toHaveProperty('percentFee');
  });

  it('returns 401 without admin key', async () => {
    const res = await client.get('/api/v1/admin/fees/defaults');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/v1/admin/fees/merchant/:merchantId ─────────

describe('POST /api/v1/admin/fees/merchant/:merchantId', () => {
  it('sets merchant fees with valid rules and returns 201', async () => {
    const res = await client.post('/api/v1/admin/fees/merchant/merchant-1', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: {
        rules: [
          { method: 'WALLET', percentFee: 0, fixedFee: 0, minFee: 0, maxFee: 0 },
          { method: 'KHIPU', percentFee: 0.5, fixedFee: 0, minFee: 0, maxFee: 0 },
        ],
      },
    });
    expect(res.status).toBe(201);
    const body = res.body as { config: FeeConfig };
    expect(body.config.merchantId).toBe('merchant-1');
    expect(body.config.rules.length).toBe(2);
    expect(body.config.updatedAt).toBeDefined();
  });

  it('returns 400 for invalid payment method', async () => {
    const res = await client.post('/api/v1/admin/fees/merchant/merchant-1', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: {
        rules: [
          { method: 'INVALID_METHOD', percentFee: 0, fixedFee: 0, minFee: 0, maxFee: 0 },
        ],
      },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing rules field', async () => {
    const res = await client.post('/api/v1/admin/fees/merchant/merchant-1', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: {},
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.post('/api/v1/admin/fees/merchant/merchant-1', {
      body: { rules: [sampleRule] },
    });
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/v1/admin/fees/merchant/:merchantId ──────────

describe('GET /api/v1/admin/fees/merchant/:merchantId', () => {
  it('returns saved merchant config', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'fees:merchant:merchant-1') return Promise.resolve(JSON.stringify(sampleConfig));
      return Promise.resolve(null);
    });

    const res = await client.get('/api/v1/admin/fees/merchant/merchant-1', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    const body = res.body as { config: FeeConfig };
    expect(body.config.merchantId).toBe('merchant-1');
    expect(body.config.rules).toHaveLength(1);
  });

  it('returns 404 when merchant config not found', async () => {
    const res = await client.get('/api/v1/admin/fees/merchant/unknown-merchant', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(404);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.get('/api/v1/admin/fees/merchant/merchant-1');
    expect(res.status).toBe(401);
  });
});

// ─── DELETE /api/v1/admin/fees/merchant/:merchantId ───────

describe('DELETE /api/v1/admin/fees/merchant/:merchantId', () => {
  it('removes merchant fees and returns 200', async () => {
    const res = await client.delete('/api/v1/admin/fees/merchant/merchant-1', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    expect((res.body as { ok: boolean }).ok).toBe(true);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.delete('/api/v1/admin/fees/merchant/merchant-1');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/v1/admin/fees/calculate ────────────────────

describe('POST /api/v1/admin/fees/calculate', () => {
  it('returns fee calculation for valid input', async () => {
    const res = await client.post('/api/v1/admin/fees/calculate', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { amount: 10000, method: 'WALLET' },
    });
    expect(res.status).toBe(200);
    const body = res.body as { calculation: FeeCalculation };
    expect(body.calculation).toHaveProperty('amount', 10000);
    expect(body.calculation).toHaveProperty('method', 'WALLET');
    expect(body.calculation).toHaveProperty('totalFee');
    expect(body.calculation).toHaveProperty('netAmount');
  });

  it('returns fee calculation with merchantId', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'fees:merchant:merchant-1') return Promise.resolve(JSON.stringify(sampleConfig));
      return Promise.resolve(null);
    });

    const res = await client.post('/api/v1/admin/fees/calculate', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { merchantId: 'merchant-1', amount: 10000, method: 'WALLET' },
    });
    expect(res.status).toBe(200);
    const body = res.body as { calculation: FeeCalculation };
    expect(body.calculation.amount).toBe(10000);
    expect(body.calculation.totalFee).toBe(0);
    expect(body.calculation.netAmount).toBe(10000);
  });

  it('returns 400 for invalid amount (below minimum)', async () => {
    const res = await client.post('/api/v1/admin/fees/calculate', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { amount: 50, method: 'WALLET' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid method', async () => {
    const res = await client.post('/api/v1/admin/fees/calculate', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { amount: 10000, method: 'BITCOIN' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.post('/api/v1/admin/fees/calculate', {
      body: { amount: 10000, method: 'WALLET' },
    });
    expect(res.status).toBe(401);
  });
});
