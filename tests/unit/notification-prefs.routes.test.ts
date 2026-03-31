/**
 * Route-level tests for notification-prefs.routes.ts
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
  mockRedisDel.mockResolvedValue(1);
});

describe('GET /api/v1/notification-prefs', () => {
  it('returns defaults for new user', async () => {
    const token = makeToken('user-1');
    const res = await client.get('/api/v1/notification-prefs', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { prefs: { enabled: boolean; quietHoursEnabled: boolean; quietStart: number; quietEnd: number } };
    expect(body.prefs.enabled).toBe(true);
    expect(body.prefs.quietHoursEnabled).toBe(false);
    expect(body.prefs.quietStart).toBe(23);
    expect(body.prefs.quietEnd).toBe(7);
  });

  it('returns saved prefs when Redis has data', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockResolvedValue(JSON.stringify({
      enabled: false, quietHoursEnabled: true, quietStart: 22, quietEnd: 8,
    }));
    const res = await client.get('/api/v1/notification-prefs', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { prefs: { enabled: boolean; quietHoursEnabled: boolean; quietStart: number; quietEnd: number } };
    expect(body.prefs.enabled).toBe(false);
    expect(body.prefs.quietHoursEnabled).toBe(true);
    expect(body.prefs.quietStart).toBe(22);
    expect(body.prefs.quietEnd).toBe(8);
  });
});

describe('POST /api/v1/notification-prefs', () => {
  it('updates quiet hours', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/notification-prefs', {
      headers: { Authorization: `Bearer ${token}` },
      body: { quietHoursEnabled: true, quietStart: 22, quietEnd: 8 },
    });
    expect(res.status).toBe(200);
    const body = res.body as { prefs: { quietHoursEnabled: boolean; quietStart: number; quietEnd: number } };
    expect(body.prefs.quietHoursEnabled).toBe(true);
    expect(body.prefs.quietStart).toBe(22);
    expect(body.prefs.quietEnd).toBe(8);
  });

  it('returns 400 for invalid quietStart (>23)', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/notification-prefs', {
      headers: { Authorization: `Bearer ${token}` },
      body: { quietStart: 25 },
    });
    expect(res.status).toBe(400);
  });
});

describe('Auth', () => {
  it('returns 401 without token on GET', async () => {
    const res = await client.get('/api/v1/notification-prefs');
    expect(res.status).toBe(401);
  });

  it('returns 401 without token on POST', async () => {
    const res = await client.post('/api/v1/notification-prefs', {
      body: { enabled: false },
    });
    expect(res.status).toBe(401);
  });
});
