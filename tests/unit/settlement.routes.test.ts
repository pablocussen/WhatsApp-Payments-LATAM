/**
 * Route-level tests for settlement.routes.ts
 * Covers: config CRUD, create, list, process, cancel, summary
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
import type { Settlement, MerchantSettlementConfig } from '../../src/services/settlement.service';

const ADMIN_KEY = 'test-admin-key-at-least-32-characters-long';
let client: TestClient;

const now = new Date().toISOString();
const sampleConfig: MerchantSettlementConfig = {
  merchantId: 'merchant-1',
  frequency: 'weekly',
  minimumAmount: 10000,
  bankName: 'Banco Estado',
  accountNumber: '12345678',
  accountType: 'corriente',
  holderName: 'Test Merchant',
  holderRut: '12345678-9',
  active: true,
};

const sampleSettlement: Settlement = {
  id: 'stl_test001',
  merchantId: 'merchant-1',
  amount: 500000,
  fee: 5000,
  netAmount: 495000,
  transactionCount: 25,
  periodStart: '2026-03-01T00:00:00.000Z',
  periodEnd: '2026-03-15T23:59:59.999Z',
  status: 'pending',
  bankAccount: null,
  transferReference: null,
  createdAt: now,
  processedAt: null,
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

// ─── POST /api/v1/admin/settlements/config ────────────────

describe('POST /api/v1/admin/settlements/config', () => {
  it('sets config with valid bank data and returns 201', async () => {
    const res = await client.post('/api/v1/admin/settlements/config', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: {
        merchantId: 'merchant-1',
        frequency: 'weekly',
        bankName: 'Banco Estado',
        accountNumber: '12345678',
        accountType: 'corriente',
        holderName: 'Test Merchant',
        holderRut: '12345678-9',
      },
    });
    expect(res.status).toBe(201);
    const body = res.body as { config: MerchantSettlementConfig };
    expect(body.config.merchantId).toBe('merchant-1');
    expect(body.config.frequency).toBe('weekly');
    expect(body.config.active).toBe(true);
    expect(body.config.bankName).toBe('Banco Estado');
  });

  it('returns 400 for invalid RUT format', async () => {
    const res = await client.post('/api/v1/admin/settlements/config', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: {
        merchantId: 'merchant-1',
        frequency: 'weekly',
        bankName: 'Banco Estado',
        accountNumber: '12345678',
        accountType: 'corriente',
        holderName: 'Test Merchant',
        holderRut: 'invalid-rut',
      },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing required fields', async () => {
    const res = await client.post('/api/v1/admin/settlements/config', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { merchantId: 'merchant-1' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.post('/api/v1/admin/settlements/config', {
      body: { merchantId: 'merchant-1' },
    });
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/v1/admin/settlements/config/:merchantId ─────

describe('GET /api/v1/admin/settlements/config/:merchantId', () => {
  it('returns saved config', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'settlement:config:merchant-1') return Promise.resolve(JSON.stringify(sampleConfig));
      return Promise.resolve(null);
    });

    const res = await client.get('/api/v1/admin/settlements/config/merchant-1', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    const body = res.body as { config: MerchantSettlementConfig };
    expect(body.config.merchantId).toBe('merchant-1');
    expect(body.config.bankName).toBe('Banco Estado');
  });

  it('returns 404 when config not found', async () => {
    const res = await client.get('/api/v1/admin/settlements/config/unknown-merchant', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/v1/admin/settlements ───────────────────────

describe('POST /api/v1/admin/settlements', () => {
  it('creates a settlement and returns 201', async () => {
    const res = await client.post('/api/v1/admin/settlements', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: {
        merchantId: 'merchant-1',
        amount: 500000,
        fee: 5000,
        transactionCount: 25,
        periodStart: '2026-03-01T00:00:00.000Z',
        periodEnd: '2026-03-15T23:59:59.999Z',
      },
    });
    expect(res.status).toBe(201);
    const body = res.body as { settlement: Settlement };
    expect(body.settlement.id).toMatch(/^stl_/);
    expect(body.settlement.merchantId).toBe('merchant-1');
    expect(body.settlement.amount).toBe(500000);
    expect(body.settlement.netAmount).toBe(495000);
    expect(body.settlement.status).toBe('pending');
  });

  it('returns 401 without admin key', async () => {
    const res = await client.post('/api/v1/admin/settlements', {
      body: { merchantId: 'merchant-1', amount: 500000, fee: 5000, transactionCount: 25, periodStart: now, periodEnd: now },
    });
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/v1/admin/settlements/:id ────────────────────

describe('GET /api/v1/admin/settlements/:id', () => {
  it('returns settlement detail', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'settlement:stl_test001') return Promise.resolve(JSON.stringify(sampleSettlement));
      return Promise.resolve(null);
    });

    const res = await client.get('/api/v1/admin/settlements/stl_test001', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    const body = res.body as { settlement: Settlement };
    expect(body.settlement.id).toBe('stl_test001');
    expect(body.settlement.amount).toBe(500000);
  });

  it('returns 404 for unknown settlement', async () => {
    const res = await client.get('/api/v1/admin/settlements/stl_unknown', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(404);
  });
});

// ─── GET /api/v1/admin/settlements/merchant/:merchantId ───

describe('GET /api/v1/admin/settlements/merchant/:merchantId', () => {
  it('returns list of merchant settlements', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'settlement:merchant:merchant-1') return Promise.resolve(JSON.stringify(['stl_test001']));
      if (key === 'settlement:stl_test001') return Promise.resolve(JSON.stringify(sampleSettlement));
      return Promise.resolve(null);
    });

    const res = await client.get('/api/v1/admin/settlements/merchant/merchant-1', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    const body = res.body as { settlements: Settlement[] };
    expect(Array.isArray(body.settlements)).toBe(true);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.get('/api/v1/admin/settlements/merchant/merchant-1');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/v1/admin/settlements/:id/process ──────────

describe('POST /api/v1/admin/settlements/:id/process', () => {
  it('processes settlement with transfer reference', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'settlement:stl_test001') return Promise.resolve(JSON.stringify(sampleSettlement));
      return Promise.resolve(null);
    });

    const res = await client.post('/api/v1/admin/settlements/stl_test001/process', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { transferReference: 'TRF-20260315-001' },
    });
    expect(res.status).toBe(200);
    const body = res.body as { settlement: Settlement };
    expect(body.settlement.status).toBe('completed');
    expect(body.settlement.transferReference).toBe('TRF-20260315-001');
  });

  it('returns 400 without transfer reference', async () => {
    const res = await client.post('/api/v1/admin/settlements/stl_test001/process', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: {},
    });
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/v1/admin/settlements/:id/cancel ───────────

describe('POST /api/v1/admin/settlements/:id/cancel', () => {
  it('cancels settlement with reason', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'settlement:stl_test001') return Promise.resolve(JSON.stringify(sampleSettlement));
      return Promise.resolve(null);
    });

    const res = await client.post('/api/v1/admin/settlements/stl_test001/cancel', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { reason: 'Merchant request' },
    });
    expect(res.status).toBe(200);
    const body = res.body as { settlement: Settlement };
    expect(body.settlement.status).toBe('cancelled');
  });

  it('returns 400 without reason', async () => {
    const res = await client.post('/api/v1/admin/settlements/stl_test001/cancel', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: {},
    });
    expect(res.status).toBe(400);
  });
});

// ─── GET /api/v1/admin/settlements/merchant/:id/summary ──

describe('GET /api/v1/admin/settlements/merchant/:merchantId/summary', () => {
  it('returns pending summary for merchant', async () => {
    const res = await client.get('/api/v1/admin/settlements/merchant/merchant-1/summary', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    const body = res.body as { summary: { totalAmount: number; count: number; totalFees: number; totalNet: number } };
    expect(body.summary).toHaveProperty('totalAmount');
    expect(body.summary).toHaveProperty('count');
    expect(body.summary).toHaveProperty('totalFees');
    expect(body.summary).toHaveProperty('totalNet');
  });
});
