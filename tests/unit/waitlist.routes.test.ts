/**
 * Route-level tests for waitlist.routes.ts + admin waitlist.
 * Covers: POST /waitlist (public), GET /admin/waitlist (admin-protected),
 *         GET /waitlist/count, rate limiting.
 */

const mockRedisSAdd = jest.fn();
const mockRedisSMembers = jest.fn();
const mockRedisSCard = jest.fn();
const mockRedisIncr = jest.fn();
const mockRedisExpire = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisDel = jest.fn();

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
    sAdd: (...args: unknown[]) => mockRedisSAdd(...args),
    sMembers: (...args: unknown[]) => mockRedisSMembers(...args),
    sCard: (...args: unknown[]) => mockRedisSCard(...args),
    incr: (...args: unknown[]) => mockRedisIncr(...args),
    expire: (...args: unknown[]) => mockRedisExpire(...args),
    set: mockRedisSet,
    get: mockRedisGet,
    del: mockRedisDel,
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

let client: TestClient;
const ADMIN_KEY = 'test-admin-key-at-least-32-characters-long';

beforeAll(async () => {
  const { default: app } = await import('../../src/api/server');
  client = await startTestServer(app);
});

afterAll(async () => {
  await client.close();
});

beforeEach(() => {
  jest.clearAllMocks();
  // Default: rate limit not exceeded
  mockRedisIncr.mockResolvedValue(1);
  mockRedisExpire.mockResolvedValue(true);
});

describe('POST /api/v1/waitlist', () => {
  it('should accept valid email and add to set', async () => {
    mockRedisSAdd.mockResolvedValue(1);
    const res = await client.post('/api/v1/waitlist', {
      body: { email: 'test@example.com' },
    });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).status).toBe('ok');
    expect(mockRedisSAdd).toHaveBeenCalledWith('waitlist:emails', 'test@example.com');
  });

  it('should lowercase and trim email', async () => {
    mockRedisSAdd.mockResolvedValue(1);
    const res = await client.post('/api/v1/waitlist', {
      body: { email: '  User@EXAMPLE.COM  ' },
    });
    expect(res.status).toBe(200);
    expect(mockRedisSAdd).toHaveBeenCalledWith('waitlist:emails', 'user@example.com');
  });

  it('should return already_registered for duplicate', async () => {
    mockRedisSAdd.mockResolvedValue(0);
    const res = await client.post('/api/v1/waitlist', {
      body: { email: 'dupe@example.com' },
    });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).status).toBe('already_registered');
  });

  it('should reject invalid email', async () => {
    const res = await client.post('/api/v1/waitlist', {
      body: { email: 'not-an-email' },
    });
    expect(res.status).toBe(400);
  });

  it('should reject missing email', async () => {
    const res = await client.post('/api/v1/waitlist', { body: {} });
    expect(res.status).toBe(400);
  });

  it('should reject empty body', async () => {
    const res = await client.post('/api/v1/waitlist', { body: '' });
    expect(res.status).toBe(400);
  });

  it('should rate limit after 5 signups per IP', async () => {
    mockRedisIncr.mockResolvedValue(6);
    const res = await client.post('/api/v1/waitlist', {
      body: { email: 'spam@example.com' },
    });
    expect(res.status).toBe(429);
    expect(mockRedisSAdd).not.toHaveBeenCalled();
  });

  it('should fail-open when rate limit Redis throws', async () => {
    mockRedisIncr.mockRejectedValue(new Error('Redis down'));
    mockRedisSAdd.mockResolvedValue(1);
    const res = await client.post('/api/v1/waitlist', {
      body: { email: 'ok@example.com' },
    });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/v1/waitlist/count', () => {
  it('should return signup count', async () => {
    mockRedisSCard.mockResolvedValue(42);
    const res = await client.get('/api/v1/waitlist/count');
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).count).toBe(42);
  });

  it('should return 0 when no signups', async () => {
    mockRedisSCard.mockResolvedValue(0);
    const res = await client.get('/api/v1/waitlist/count');
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).count).toBe(0);
  });
});

describe('GET /api/v1/admin/waitlist', () => {
  it('should return emails with valid admin key', async () => {
    mockRedisSMembers.mockResolvedValue(['a@b.com', 'c@d.com']);
    const res = await client.get('/api/v1/admin/waitlist', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    const body = res.body as Record<string, unknown>;
    expect(body.count).toBe(2);
    expect(body.emails).toEqual(['a@b.com', 'c@d.com']);
  });

  it('should reject without admin key', async () => {
    const res = await client.get('/api/v1/admin/waitlist');
    expect(res.status).toBe(401);
  });

  it('should reject with wrong admin key', async () => {
    const res = await client.get('/api/v1/admin/waitlist', {
      headers: { 'x-admin-key': 'wrong-key' },
    });
    expect(res.status).toBe(401);
  });

  it('should return empty list when no signups', async () => {
    mockRedisSMembers.mockResolvedValue([]);
    const res = await client.get('/api/v1/admin/waitlist', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>).count).toBe(0);
  });
});
