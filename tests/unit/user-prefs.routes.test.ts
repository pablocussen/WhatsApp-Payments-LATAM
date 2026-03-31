/**
 * Route-level tests for user-prefs.routes.ts
 * Covers: GET /preferences, POST /preferences, DELETE /preferences
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisDel = jest.fn().mockResolvedValue(1);
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
    del: (...args: unknown[]) => mockRedisDel(...args),
    incr: (...args: unknown[]) => mockRedisIncr(...args),
    sAdd: jest.fn(), sRem: jest.fn(), sMembers: jest.fn(), sCard: jest.fn(),
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
  mockRedisIncr.mockResolvedValue(1);
});

// ─── GET /api/v1/preferences ────────────────────────────

describe('GET /api/v1/preferences', () => {
  it('returns defaults for new user', async () => {
    const token = makeToken('user-1');
    const res = await client.get('/api/v1/preferences', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { preferences: { language: string; confirmBeforePay: boolean } };
    expect(body.preferences.language).toBe('es');
    expect(body.preferences.confirmBeforePay).toBe(true);
  });

  it('returns saved preferences', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockResolvedValue(JSON.stringify({ language: 'en', nickName: 'Pablo' }));
    const res = await client.get('/api/v1/preferences', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { preferences: { language: string; nickName: string } };
    expect(body.preferences.language).toBe('en');
    expect(body.preferences.nickName).toBe('Pablo');
  });

  it('returns 401 without token', async () => {
    const res = await client.get('/api/v1/preferences');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/v1/preferences ───────────────────────────

describe('POST /api/v1/preferences', () => {
  it('updates language', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/preferences', {
      headers: { Authorization: `Bearer ${token}` },
      body: { language: 'en' },
    });
    expect(res.status).toBe(200);
    expect((res.body as { preferences: { language: string } }).preferences.language).toBe('en');
  });

  it('updates multiple fields', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/preferences', {
      headers: { Authorization: `Bearer ${token}` },
      body: { nickName: 'Pablito', defaultTipPercent: 10, showBalanceOnGreet: true },
    });
    expect(res.status).toBe(200);
    const prefs = (res.body as { preferences: { nickName: string; defaultTipPercent: number } }).preferences;
    expect(prefs.nickName).toBe('Pablito');
    expect(prefs.defaultTipPercent).toBe(10);
  });

  it('returns 400 for invalid language', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/preferences', {
      headers: { Authorization: `Bearer ${token}` },
      body: { language: 'fr' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for tip > 20', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/preferences', {
      headers: { Authorization: `Bearer ${token}` },
      body: { defaultTipPercent: 25 },
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 without token', async () => {
    const res = await client.post('/api/v1/preferences', { body: { language: 'en' } });
    expect(res.status).toBe(401);
  });
});

// ─── DELETE /api/v1/preferences ─────────────────────────

describe('DELETE /api/v1/preferences', () => {
  it('resets to defaults', async () => {
    const token = makeToken('user-1');
    const res = await client.delete('/api/v1/preferences', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { preferences: { language: string }; message: string };
    expect(body.preferences.language).toBe('es');
    expect(body.message).toContain('restauradas');
  });

  it('returns 401 without token', async () => {
    const res = await client.delete('/api/v1/preferences');
    expect(res.status).toBe(401);
  });
});
