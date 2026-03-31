/**
 * Route-level tests for merchant-analytics routes (admin-protected).
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
      exec: jest.fn().mockResolvedValue([0,0,0,0,0,0,0,0,0,0]),
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

const SAMPLE_METRICS = {
  merchantId: 'merchant-1', period: 'daily', periodKey: '2026-03-31',
  totalTransactions: 50, totalVolume: 5000000, totalFees: 100000,
  avgTransactionSize: 100000, successRate: 95, uniqueCustomers: 30,
  refundCount: 2, refundVolume: 50000, chargebackCount: 0,
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
});

describe('GET /admin/merchant-analytics/:merchantId/:period/:periodKey', () => {
  it('returns saved metrics', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(SAMPLE_METRICS));
    const res = await client.get(
      '/api/v1/admin/merchant-analytics/merchant-1/daily/2026-03-31',
      { headers: { 'x-admin-key': ADMIN_KEY } },
    );
    expect(res.status).toBe(200);
    const body = res.body as { metrics: typeof SAMPLE_METRICS };
    expect(body.metrics.totalVolume).toBe(5000000);
  });

  it('returns 404 when not found', async () => {
    const res = await client.get(
      '/api/v1/admin/merchant-analytics/merchant-999/daily/2026-03-31',
      { headers: { 'x-admin-key': ADMIN_KEY } },
    );
    expect(res.status).toBe(404);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.get('/api/v1/admin/merchant-analytics/merchant-1/daily/2026-03-31');
    expect(res.status).toBe(401);
  });
});

describe('GET /admin/merchant-analytics/:merchantId/trend', () => {
  it('returns trend data', async () => {
    mockRedisGet
      .mockResolvedValueOnce(JSON.stringify(['2026-03-30', '2026-03-31']))
      .mockResolvedValueOnce(JSON.stringify({ ...SAMPLE_METRICS, totalVolume: 4000000 }))
      .mockResolvedValueOnce(JSON.stringify(SAMPLE_METRICS));

    const res = await client.get(
      '/api/v1/admin/merchant-analytics/merchant-1/trend?period=daily&metric=totalVolume',
      { headers: { 'x-admin-key': ADMIN_KEY } },
    );
    expect(res.status).toBe(200);
    const body = res.body as { trend: Array<{ periodKey: string; value: number }> };
    expect(Array.isArray(body.trend)).toBe(true);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.get('/api/v1/admin/merchant-analytics/merchant-1/trend?period=daily&metric=totalVolume');
    expect(res.status).toBe(401);
  });
});

describe('GET /admin/merchant-analytics/:merchantId/performance', () => {
  it('returns comparison', async () => {
    mockRedisGet
      .mockResolvedValueOnce(JSON.stringify(SAMPLE_METRICS))
      .mockResolvedValueOnce(JSON.stringify({ ...SAMPLE_METRICS, totalVolume: 4000000, totalTransactions: 40, totalFees: 80000 }));

    const res = await client.get(
      '/api/v1/admin/merchant-analytics/merchant-1/performance?period=daily&currentPeriodKey=2026-03-31&previousPeriodKey=2026-03-30',
      { headers: { 'x-admin-key': ADMIN_KEY } },
    );
    expect(res.status).toBe(200);
    const body = res.body as { performance: { volumeChange: number } };
    expect(body.performance.volumeChange).toBe(25);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.get('/api/v1/admin/merchant-analytics/merchant-1/performance?period=daily&currentPeriodKey=a&previousPeriodKey=b');
    expect(res.status).toBe(401);
  });
});

describe('GET /admin/merchant-analytics/:merchantId/periods', () => {
  it('returns period keys', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(['2026-03-30', '2026-03-31']));
    const res = await client.get(
      '/api/v1/admin/merchant-analytics/merchant-1/periods?period=daily',
      { headers: { 'x-admin-key': ADMIN_KEY } },
    );
    expect(res.status).toBe(200);
    const body = res.body as { periods: string[] };
    expect(body.periods).toContain('2026-03-31');
  });

  it('returns 401 without admin key', async () => {
    const res = await client.get('/api/v1/admin/merchant-analytics/merchant-1/periods?period=daily');
    expect(res.status).toBe(401);
  });
});
