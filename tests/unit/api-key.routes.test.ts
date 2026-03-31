/**
 * Route-level tests for api-key.routes.ts
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

describe('POST /api/v1/admin/api-keys', () => {
  it('creates key, returns 201 with id and key', async () => {
    const res = await client.post('/api/v1/admin/api-keys', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: {
        merchantId: 'merchant-1',
        name: 'Production Key',
        permissions: ['payments:read', 'payments:write'],
      },
    });
    expect(res.status).toBe(201);
    const body = res.body as { key: { id: string; key: string; name: string } };
    expect(body.key.id).toBeDefined();
    expect(body.key.key).toBeDefined();
    expect(body.key.name).toBe('Production Key');
  });

  it('returns 400 for missing fields', async () => {
    const res = await client.post('/api/v1/admin/api-keys', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { merchantId: 'merchant-1' },
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/admin/api-keys/merchant/:merchantId', () => {
  it('returns keys list', async () => {
    // Mock getKeys to return stored keys
    const storedKey = { id: 'key-1', name: 'Test Key', keyPrefix: 'wp_live_test', keyHash: 'abc', merchantId: 'merchant-1', permissions: ['payments:read'], createdAt: new Date().toISOString(), lastUsedAt: null, active: true };
    mockRedisGet.mockResolvedValue(JSON.stringify([storedKey]));

    const res = await client.get('/api/v1/admin/api-keys/merchant/merchant-1', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    const body = res.body as { keys: unknown[]; count: number };
    expect(Array.isArray(body.keys)).toBe(true);
    expect(body.count).toBe(1);
  });
});

describe('DELETE /api/v1/admin/api-keys/:keyId', () => {
  it('returns 200 when key exists', async () => {
    // First create a key to get a valid ID
    const createRes = await client.post('/api/v1/admin/api-keys', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: {
        merchantId: 'merchant-1',
        name: 'To Delete',
        permissions: ['payments:read'],
      },
    });
    const keyId = (createRes.body as { key: { id: string } }).key.id;

    // Mock getKeys to return the key so revokeKey finds it
    const storedKey = { id: keyId, name: 'To Delete', keyPrefix: 'wp_live_test', keyHash: 'abc', merchantId: 'merchant-1', permissions: ['payments:read'], createdAt: new Date().toISOString(), lastUsedAt: null, active: true };
    mockRedisGet.mockResolvedValue(JSON.stringify([storedKey]));

    const res = await client.delete(`/api/v1/admin/api-keys/${keyId}?merchantId=merchant-1`, {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    expect((res.body as { deleted: boolean }).deleted).toBe(true);
  });

  it('returns 404 for unknown key', async () => {
    const res = await client.delete('/api/v1/admin/api-keys/unknown?merchantId=merchant-1', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(404);
  });
});

describe('Admin key auth', () => {
  it('returns 401 without admin key', async () => {
    const res = await client.get('/api/v1/admin/api-keys/merchant/merchant-1');
    expect(res.status).toBe(401);
  });
});
