/**
 * Route-level tests for analytics.routes.ts
 * Covers: GET /admin/analytics/daily, /active-users, /user/:id/insights
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
import type { DailyStats, UserInsights } from '../../src/services/analytics.service';

const ADMIN_KEY = 'test-admin-key-at-least-32-characters-long';
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
  mockRedisDel.mockResolvedValue(1);
});

// ─── GET /api/v1/admin/analytics/daily ────────────────────

describe('GET /api/v1/admin/analytics/daily', () => {
  it('returns daily stats array with date/amount/count', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (typeof key === 'string' && key.includes('daily:amount')) return Promise.resolve('500000');
      if (typeof key === 'string' && key.includes('daily:count')) return Promise.resolve('10');
      return Promise.resolve(null);
    });

    const res = await client.get(
      '/api/v1/admin/analytics/daily?startDate=2026-03-01&endDate=2026-03-02',
      { headers: { 'x-admin-key': ADMIN_KEY } },
    );
    expect(res.status).toBe(200);
    const body = res.body as { stats: DailyStats[] };
    expect(Array.isArray(body.stats)).toBe(true);
    expect(body.stats.length).toBe(2);
    expect(body.stats[0]).toHaveProperty('date');
    expect(body.stats[0]).toHaveProperty('totalAmount');
    expect(body.stats[0]).toHaveProperty('transactionCount');
    expect(body.stats[0]).toHaveProperty('averageAmount');
    expect(body.stats[0].totalAmount).toBe(500000);
    expect(body.stats[0].transactionCount).toBe(10);
    expect(body.stats[0].averageAmount).toBe(50000);
  });

  it('returns empty stats when no data exists', async () => {
    const res = await client.get(
      '/api/v1/admin/analytics/daily?startDate=2026-03-01&endDate=2026-03-01',
      { headers: { 'x-admin-key': ADMIN_KEY } },
    );
    expect(res.status).toBe(200);
    const body = res.body as { stats: DailyStats[] };
    expect(body.stats[0].totalAmount).toBe(0);
    expect(body.stats[0].transactionCount).toBe(0);
    expect(body.stats[0].averageAmount).toBe(0);
  });

  it('returns 400 without startDate and endDate', async () => {
    const res = await client.get('/api/v1/admin/analytics/daily', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toContain('startDate');
  });

  it('returns 401 without admin key', async () => {
    const res = await client.get('/api/v1/admin/analytics/daily?startDate=2026-03-01&endDate=2026-03-02');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/v1/admin/analytics/active-users ─────────────

describe('GET /api/v1/admin/analytics/active-users', () => {
  it('returns dau/wau/mau counts', async () => {
    const res = await client.get('/api/v1/admin/analytics/active-users', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    const body = res.body as { counts: { dau: number; wau: number; mau: number } };
    expect(body.counts).toHaveProperty('dau');
    expect(body.counts).toHaveProperty('wau');
    expect(body.counts).toHaveProperty('mau');
    expect(typeof body.counts.dau).toBe('number');
  });

  it('returns 401 without admin key', async () => {
    const res = await client.get('/api/v1/admin/analytics/active-users');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/v1/admin/analytics/user/:userId/insights ────

describe('GET /api/v1/admin/analytics/user/:userId/insights', () => {
  it('returns full insights object for user', async () => {
    const res = await client.get('/api/v1/admin/analytics/user/user-1/insights', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    const body = res.body as { insights: UserInsights };
    expect(body.insights).toHaveProperty('totalSent');
    expect(body.insights).toHaveProperty('totalReceived');
    expect(body.insights).toHaveProperty('transactionCount');
    expect(body.insights).toHaveProperty('averageTransaction');
    expect(body.insights).toHaveProperty('topRecipients');
    expect(body.insights).toHaveProperty('byDayOfWeek');
    expect(body.insights).toHaveProperty('peakHour');
    expect(body.insights).toHaveProperty('hourDistribution');
    expect(Array.isArray(body.insights.hourDistribution)).toBe(true);
    expect(body.insights.hourDistribution).toHaveLength(24);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.get('/api/v1/admin/analytics/user/user-1/insights');
    expect(res.status).toBe(401);
  });
});
