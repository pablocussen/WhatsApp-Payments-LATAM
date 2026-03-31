/**
 * Route-level tests for spending-limits.routes.ts
 * Covers: GET /spending-limits, POST /spending-limits,
 *         GET /spending-limits/status, POST /admin/spending-limits/:userId
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
    del: jest.fn(), sAdd: jest.fn(), sRem: jest.fn(), sMembers: jest.fn(), sCard: jest.fn(),
    lPush: jest.fn(), lRange: jest.fn().mockResolvedValue([]),
    expire: jest.fn().mockResolvedValue(true),
    ping: jest.fn().mockResolvedValue('PONG'),
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

beforeAll(async () => {
  const { default: app } = await import('../../src/api/server');
  client = await startTestServer(app);
});
afterAll(async () => { await client.close(); });
beforeEach(() => {
  jest.clearAllMocks();
  mockRedisGet.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue('OK');
  mockRedisIncr.mockResolvedValue(1);
});

// ─── GET /api/v1/spending-limits ────────────────────────

describe('GET /api/v1/spending-limits', () => {
  it('returns defaults for new user', async () => {
    const token = makeToken('user-1');
    const res = await client.get('/api/v1/spending-limits', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { limits: { dailyLimit: number; alertThreshold: number } };
    expect(body.limits.dailyLimit).toBe(0);
    expect(body.limits.alertThreshold).toBe(80);
  });

  it('returns saved limits', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockResolvedValue(JSON.stringify({ dailyLimit: 500000, weeklyLimit: 2000000 }));
    const res = await client.get('/api/v1/spending-limits', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { limits: { dailyLimit: number; weeklyLimit: number } };
    expect(body.limits.dailyLimit).toBe(500000);
    expect(body.limits.weeklyLimit).toBe(2000000);
  });

  it('returns 401 without token', async () => {
    const res = await client.get('/api/v1/spending-limits');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/v1/spending-limits ───────────────────────

describe('POST /api/v1/spending-limits', () => {
  it('sets daily and weekly limits', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/spending-limits', {
      headers: { Authorization: `Bearer ${token}` },
      body: { dailyLimit: 100000, weeklyLimit: 500000 },
    });
    expect(res.status).toBe(200);
    const body = res.body as { limits: { dailyLimit: number; weeklyLimit: number } };
    expect(body.limits.dailyLimit).toBe(100000);
    expect(body.limits.weeklyLimit).toBe(500000);
  });

  it('sets alert threshold', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/spending-limits', {
      headers: { Authorization: `Bearer ${token}` },
      body: { alertThreshold: 90 },
    });
    expect(res.status).toBe(200);
    expect((res.body as { limits: { alertThreshold: number } }).limits.alertThreshold).toBe(90);
  });

  it('returns 400 for negative limit', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/spending-limits', {
      headers: { Authorization: `Bearer ${token}` },
      body: { dailyLimit: -1000 },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for threshold > 100', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/spending-limits', {
      headers: { Authorization: `Bearer ${token}` },
      body: { alertThreshold: 150 },
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 without token', async () => {
    const res = await client.post('/api/v1/spending-limits', { body: { dailyLimit: 100000 } });
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/v1/spending-limits/status ─────────────────

describe('GET /api/v1/spending-limits/status', () => {
  it('returns spending status', async () => {
    const token = makeToken('user-1');
    const res = await client.get('/api/v1/spending-limits/status', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { status: { daily: { spent: number }; weekly: { spent: number } } };
    expect(body.status.daily.spent).toBe(0);
    expect(body.status.weekly.spent).toBe(0);
  });

  it('returns 401 without token', async () => {
    const res = await client.get('/api/v1/spending-limits/status');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/v1/admin/spending-limits/:userId ─────────

describe('POST /api/v1/admin/spending-limits/:userId', () => {
  it('sets limits for user (admin)', async () => {
    const res = await client.post('/api/v1/admin/spending-limits/user-1', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { dailyLimit: 200000, weeklyLimit: 1000000 },
    });
    expect(res.status).toBe(200);
    const body = res.body as { userId: string; limits: { dailyLimit: number } };
    expect(body.userId).toBe('user-1');
    expect(body.limits.dailyLimit).toBe(200000);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.post('/api/v1/admin/spending-limits/user-1', {
      body: { dailyLimit: 100000 },
    });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid data', async () => {
    const res = await client.post('/api/v1/admin/spending-limits/user-1', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { alertThreshold: 200 },
    });
    expect(res.status).toBe(400);
  });
});
