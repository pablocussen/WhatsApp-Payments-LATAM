/**
 * Route-level tests for activity.routes.ts
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
import { getRedis } from '../../src/config/database';

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

describe('GET /api/v1/admin/activity/user/:userId', () => {
  it('returns activity with lastSeen, loginCount, recentEvents', async () => {
    const event = { type: 'LOGIN', userId: 'user-1', timestamp: '2026-03-30T10:00:00.000Z' };
    mockRedisGet
      .mockResolvedValueOnce('2026-03-30T10:00:00.000Z')  // lastSeen
      .mockResolvedValueOnce('5');                          // loginCount
    const redis = getRedis();
    (redis.lRange as jest.Mock).mockResolvedValueOnce([JSON.stringify(event)]);

    const res = await client.get('/api/v1/admin/activity/user/user-1', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    const body = res.body as { activity: { lastSeen: string; loginCount: number; recentEvents: unknown[] } };
    expect(body.activity.lastSeen).toBe('2026-03-30T10:00:00.000Z');
    expect(body.activity.loginCount).toBe(5);
    expect(body.activity.recentEvents).toHaveLength(1);
  });

  it('returns defaults for new user', async () => {
    const res = await client.get('/api/v1/admin/activity/user/new-user', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    const body = res.body as { activity: { lastSeen: null; loginCount: number; recentEvents: unknown[] } };
    expect(body.activity.lastSeen).toBeNull();
    expect(body.activity.loginCount).toBe(0);
    expect(body.activity.recentEvents).toHaveLength(0);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.get('/api/v1/admin/activity/user/user-1');
    expect(res.status).toBe(401);
  });
});
