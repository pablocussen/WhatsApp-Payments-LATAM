/**
 * Route-level tests for currency.routes.ts
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

describe('GET /api/v1/currency/supported', () => {
  it('returns array of currencies including CLP and USD', async () => {
    const res = await client.get('/api/v1/currency/supported');
    expect(res.status).toBe(200);
    const body = res.body as { currencies: string[] };
    expect(Array.isArray(body.currencies)).toBe(true);
    expect(body.currencies).toContain('CLP');
    expect(body.currencies).toContain('USD');
  });
});

describe('GET /api/v1/currency/rates', () => {
  it('returns object with rate entries', async () => {
    const res = await client.get('/api/v1/currency/rates');
    expect(res.status).toBe(200);
    const body = res.body as { rates: Record<string, unknown> };
    expect(body.rates).toBeDefined();
    expect(typeof body.rates).toBe('object');
  });
});

describe('GET /api/v1/currency/convert', () => {
  it('returns conversion result for valid params', async () => {
    const res = await client.get('/api/v1/currency/convert?from=USD&to=CLP&amount=100');
    expect(res.status).toBe(200);
    const body = res.body as { result: { from: { amount: number }; to: { amount: number }; rate: number } };
    expect(body.result).toBeDefined();
    expect(body.result.from.amount).toBe(100);
    expect(body.result.to.amount).toBeGreaterThan(0);
    expect(body.result.rate).toBeGreaterThan(0);
  });

  it('returns 400 without params', async () => {
    const res = await client.get('/api/v1/currency/convert');
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid currency', async () => {
    const res = await client.get('/api/v1/currency/convert?from=INVALID&to=CLP&amount=100');
    expect(res.status).toBe(400);
  });
});
