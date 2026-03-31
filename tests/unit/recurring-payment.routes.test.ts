/**
 * Route-level tests for recurring-payment.routes.ts
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
    lTrim: jest.fn(),
    expire: jest.fn().mockResolvedValue(true), ping: jest.fn().mockResolvedValue('PONG'),
    multi: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnThis(), incr: jest.fn().mockReturnThis(),
      lPush: jest.fn().mockReturnThis(), lTrim: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(), incrBy: jest.fn().mockReturnThis(),
      sAdd: jest.fn().mockReturnThis(), del: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([null,null,null,null,null]),
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
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
const ADMIN_KEY = 'test-admin-key-at-least-32-characters-long';
const makeToken = (userId: string) =>
  jwt.sign({ userId, waId: '56912345678', kycLevel: 'BASIC' }, JWT_SECRET,
    { expiresIn: '30m', issuer: 'whatpay', audience: 'whatpay-api' });

let client: TestClient;

const samplePlan = {
  id: 'sub_test001',
  merchantId: 'merchant-1',
  subscriberId: 'user-1',
  amount: 15000,
  frequency: 'monthly',
  description: 'Plan Premium',
  status: 'active',
  nextChargeDate: '2026-04-15',
  createdAt: new Date().toISOString(),
  lastChargedAt: null,
  totalCharged: 0,
  chargeCount: 0,
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

describe('GET /api/v1/subscriptions', () => {
  it('returns user plans', async () => {
    const token = makeToken('user-1');
    // getUserPlans reads the user plans index, then each plan by id
    mockRedisGet
      .mockResolvedValueOnce(JSON.stringify(['sub_test001']))  // user plans index
      .mockResolvedValueOnce(JSON.stringify(samplePlan));      // plan by id
    const res = await client.get('/api/v1/subscriptions', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { plans: unknown[]; count: number };
    expect(body.plans).toHaveLength(1);
    expect(body.count).toBe(1);
  });
});

describe('GET /api/v1/subscriptions/:id', () => {
  it('returns plan detail', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockResolvedValue(JSON.stringify(samplePlan));
    const res = await client.get('/api/v1/subscriptions/sub_test001', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { plan: { id: string; description: string } };
    expect(body.plan.id).toBe('sub_test001');
    expect(body.plan.description).toBe('Plan Premium');
  });

  it('returns 404 when not found', async () => {
    const token = makeToken('user-1');
    const res = await client.get('/api/v1/subscriptions/sub_unknown', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/subscriptions/:id/pause', () => {
  it('pauses an active plan', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockResolvedValue(JSON.stringify(samplePlan));
    const res = await client.post('/api/v1/subscriptions/sub_test001/pause', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/v1/subscriptions/:id/cancel', () => {
  it('cancels a plan', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockResolvedValue(JSON.stringify(samplePlan));
    const res = await client.post('/api/v1/subscriptions/sub_test001/cancel', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/v1/admin/subscriptions', () => {
  it('creates plan, returns 201', async () => {
    const res = await client.post('/api/v1/admin/subscriptions', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: {
        merchantId: 'merchant-1',
        subscriberId: 'user-1',
        amount: 15000,
        frequency: 'monthly',
        description: 'Plan Premium',
      },
    });
    expect(res.status).toBe(201);
    const body = res.body as { plan: { id: string; amount: number } };
    expect(body.plan.id).toBeDefined();
    expect(body.plan.amount).toBe(15000);
  });

  it('returns 400 for amount < 100', async () => {
    const res = await client.post('/api/v1/admin/subscriptions', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: {
        merchantId: 'merchant-1',
        subscriberId: 'user-1',
        amount: 50,
        frequency: 'monthly',
        description: 'Too cheap',
      },
    });
    expect(res.status).toBe(400);
  });
});

describe('Auth', () => {
  it('returns 401 without token/key', async () => {
    const res = await client.get('/api/v1/subscriptions');
    expect(res.status).toBe(401);
  });
});
