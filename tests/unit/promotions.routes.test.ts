/**
 * Route-level tests for promotions.routes.ts
 * Covers: GET /promotions, GET /promotions/validate/:code,
 *         POST /promotions/apply, POST/DELETE /admin/promotions
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisIncr = jest.fn().mockResolvedValue(1);

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
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    incr: (...args: unknown[]) => mockRedisIncr(...args),
    sAdd: jest.fn(),
    sRem: jest.fn(),
    sMembers: jest.fn(),
    sCard: jest.fn(),
    expire: jest.fn().mockResolvedValue(true),
    del: jest.fn(),
    ping: jest.fn().mockResolvedValue('PONG'),
  }),
  connectRedis: jest.fn(),
  prisma: { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) },
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

jest.mock('../../src/services/scheduler.service', () => ({
  SchedulerService: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    stop: jest.fn(),
  })),
}));

import { startTestServer, type TestClient } from './http-test-client';
import jwt from 'jsonwebtoken';
import type { Promotion } from '../../src/services/promotion.service';

const JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
const ADMIN_KEY = 'test-admin-key-at-least-32-characters-long';
const makeToken = (userId: string) =>
  jwt.sign(
    { userId, waId: '56912345678', kycLevel: 'BASIC' },
    JWT_SECRET,
    { expiresIn: '30m', issuer: 'whatpay', audience: 'whatpay-api' },
  );

let client: TestClient;

const futureDate = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
const pastDate = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

const activePromo: Promotion = {
  id: 'prm_test001',
  name: '10% descuento',
  description: 'Descuento de lanzamiento',
  type: 'percentage',
  value: 10,
  minAmount: 1000,
  maxDiscount: 5000,
  scope: 'global',
  scopeId: null,
  code: 'LAUNCH10',
  usageLimit: 100,
  usageCount: 5,
  perUserLimit: 1,
  startDate: pastDate,
  endDate: futureDate,
  active: true,
  createdAt: pastDate,
};

beforeAll(async () => {
  const { default: app } = await import('../../src/api/server');
  client = await startTestServer(app);
});

afterAll(async () => {
  await client.close();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisGet.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue('OK');
  mockRedisIncr.mockResolvedValue(1);
});

// ─── GET /api/v1/promotions ──────────────────────────────

describe('GET /api/v1/promotions', () => {
  it('returns active promotions (public)', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'promo:index') return Promise.resolve(JSON.stringify(['prm_test001']));
      if (key === 'promo:prm_test001') return Promise.resolve(JSON.stringify(activePromo));
      return Promise.resolve(null);
    });

    const res = await client.get('/api/v1/promotions');
    expect(res.status).toBe(200);
    const body = res.body as { promotions: Promotion[] };
    expect(body.promotions).toHaveLength(1);
    expect(body.promotions[0].name).toBe('10% descuento');
    expect(body.promotions[0].code).toBe('LAUNCH10');
  });

  it('returns empty array when no promotions', async () => {
    const res = await client.get('/api/v1/promotions');
    expect(res.status).toBe(200);
    expect((res.body as { promotions: unknown[] }).promotions).toEqual([]);
  });

  it('does not require authentication', async () => {
    const res = await client.get('/api/v1/promotions');
    expect(res.status).not.toBe(401);
  });
});

// ─── GET /api/v1/promotions/validate/:code ───────────────

describe('GET /api/v1/promotions/validate/:code', () => {
  it('returns valid=true for active code', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'promo:code:LAUNCH10') return Promise.resolve('prm_test001');
      if (key === 'promo:prm_test001') return Promise.resolve(JSON.stringify(activePromo));
      return Promise.resolve(null);
    });

    const res = await client.get('/api/v1/promotions/validate/LAUNCH10');
    expect(res.status).toBe(200);
    const body = res.body as { valid: boolean; promo: { name: string } };
    expect(body.valid).toBe(true);
    expect(body.promo.name).toBe('10% descuento');
  });

  it('upcases code lookup', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'promo:code:LAUNCH10') return Promise.resolve('prm_test001');
      if (key === 'promo:prm_test001') return Promise.resolve(JSON.stringify(activePromo));
      return Promise.resolve(null);
    });

    const res = await client.get('/api/v1/promotions/validate/launch10');
    expect(res.status).toBe(200);
    expect((res.body as { valid: boolean }).valid).toBe(true);
  });

  it('returns 404 for unknown code', async () => {
    const res = await client.get('/api/v1/promotions/validate/NOPE');
    expect(res.status).toBe(404);
    expect((res.body as { valid: boolean }).valid).toBe(false);
  });

  it('returns 404 for inactive code', async () => {
    const inactive = { ...activePromo, active: false };
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'promo:code:INACTIVE') return Promise.resolve('prm_test001');
      if (key === 'promo:prm_test001') return Promise.resolve(JSON.stringify(inactive));
      return Promise.resolve(null);
    });

    const res = await client.get('/api/v1/promotions/validate/INACTIVE');
    expect(res.status).toBe(404);
  });

  it('returns 409 for exhausted code (usageLimit reached)', async () => {
    const exhausted = { ...activePromo, usageCount: 100 }; // usageLimit = 100
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'promo:code:LAUNCH10') return Promise.resolve('prm_test001');
      if (key === 'promo:prm_test001') return Promise.resolve(JSON.stringify(exhausted));
      return Promise.resolve(null);
    });

    const res = await client.get('/api/v1/promotions/validate/LAUNCH10');
    expect(res.status).toBe(409);
  });
});

// ─── POST /api/v1/promotions/apply ───────────────────────

describe('POST /api/v1/promotions/apply', () => {
  it('applies valid promo code (auth required)', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'promo:code:LAUNCH10') return Promise.resolve('prm_test001');
      if (key === 'promo:prm_test001') return Promise.resolve(JSON.stringify(activePromo));
      if (key === 'promo:usage:prm_test001:user-1') return Promise.resolve(null);
      return Promise.resolve(null);
    });

    const res = await client.post('/api/v1/promotions/apply', {
      headers: { Authorization: `Bearer ${token}` },
      body: { code: 'LAUNCH10', amount: 10000 },
    });
    expect(res.status).toBe(200);
    const body = res.body as { applied: { discount: number; finalAmount: number } };
    expect(body.applied.discount).toBe(1000); // 10% of 10000
    expect(body.applied.finalAmount).toBe(9000);
  });

  it('returns 404 for unknown code', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/promotions/apply', {
      headers: { Authorization: `Bearer ${token}` },
      body: { code: 'INVALID', amount: 10000 },
    });
    expect(res.status).toBe(404);
  });

  it('returns 409 when promo not applicable (amount too low)', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'promo:code:LAUNCH10') return Promise.resolve('prm_test001');
      if (key === 'promo:prm_test001') return Promise.resolve(JSON.stringify(activePromo));
      return Promise.resolve(null);
    });

    const res = await client.post('/api/v1/promotions/apply', {
      headers: { Authorization: `Bearer ${token}` },
      body: { code: 'LAUNCH10', amount: 500 }, // minAmount is 1000
    });
    expect(res.status).toBe(409);
  });

  it('returns 400 for invalid body', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/promotions/apply', {
      headers: { Authorization: `Bearer ${token}` },
      body: { code: 'X' }, // missing amount
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 without token', async () => {
    const res = await client.post('/api/v1/promotions/apply', {
      body: { code: 'LAUNCH10', amount: 10000 },
    });
    expect(res.status).toBe(401);
  });
});

// ─── Admin endpoints ─────────────────────────────────────

describe('POST /api/v1/admin/promotions', () => {
  it('creates a promotion with valid admin key', async () => {
    const res = await client.post('/api/v1/admin/promotions', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: {
        name: 'Test Promo',
        type: 'fixed',
        value: 500,
        startDate: new Date().toISOString(),
        endDate: futureDate,
      },
    });
    expect(res.status).toBe(201);
    const body = res.body as { promo: { name: string; type: string } };
    expect(body.promo.name).toBe('Test Promo');
    expect(body.promo.type).toBe('fixed');
  });

  it('returns 401 without admin key', async () => {
    const res = await client.post('/api/v1/admin/promotions', {
      body: { name: 'X', type: 'fixed', value: 100, startDate: new Date().toISOString(), endDate: futureDate },
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid data', async () => {
    const res = await client.post('/api/v1/admin/promotions', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { name: 'Bad', type: 'invalid_type', value: 10, startDate: 'bad', endDate: 'bad' },
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/v1/admin/promotions/:id', () => {
  it('deactivates existing promotion', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'promo:prm_test001') return Promise.resolve(JSON.stringify(activePromo));
      return Promise.resolve(null);
    });

    const res = await client.delete('/api/v1/admin/promotions/prm_test001', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    expect((res.body as { id: string }).id).toBe('prm_test001');
  });

  it('returns 404 for unknown promotion', async () => {
    const res = await client.delete('/api/v1/admin/promotions/prm_unknown', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(404);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.delete('/api/v1/admin/promotions/prm_test001');
    expect(res.status).toBe(401);
  });
});
