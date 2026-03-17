/**
 * Route-level tests for referral.routes.ts
 * Covers: GET /referrals/my-code, GET /referrals/stats,
 *         POST /referrals/apply, GET /referrals/validate/:code
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');

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
    sAdd: jest.fn(),
    sRem: jest.fn(),
    sMembers: jest.fn(),
    sCard: jest.fn(),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(true),
    del: jest.fn(),
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
import jwt from 'jsonwebtoken';
import type { ReferralCode, Referral } from '../../src/services/referral.service';

const JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
const makeToken = (userId: string) =>
  jwt.sign(
    { userId, waId: '56912345678', kycLevel: 'BASIC' },
    JWT_SECRET,
    { expiresIn: '30m', issuer: 'whatpay', audience: 'whatpay-api' },
  );

let client: TestClient;

const sampleCode: ReferralCode = {
  code: 'WPABCD1234',
  userId: 'user-referrer',
  createdAt: '2026-01-01T00:00:00.000Z',
  usageCount: 3,
  maxUses: 50,
  rewardPerReferral: 1000,
  rewardForReferred: 500,
  active: true,
};

const sampleReferral: Referral = {
  id: 'ref_abc123',
  code: 'WPABCD1234',
  referrerId: 'user-referrer',
  referredId: 'user-new',
  status: 'pending',
  referrerReward: 1000,
  referredReward: 500,
  createdAt: '2026-01-15T10:00:00.000Z',
  completedAt: null,
};

beforeAll(async () => {
  const { default: app } = await import('../../src/api/server');
  client = await startTestServer(app);
});

afterAll(async () => {
  await client.close();
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisGet.mockResolvedValue(null);
  mockRedisSet.mockResolvedValue('OK');
});

// ─── GET /api/v1/referrals/my-code ──────────────────────

describe('GET /api/v1/referrals/my-code', () => {
  it('returns existing code for authenticated user', async () => {
    const token = makeToken('user-referrer');
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'referral:user:user-referrer') return Promise.resolve('WPABCD1234');
      if (key === 'referral:code:WPABCD1234') return Promise.resolve(JSON.stringify(sampleCode));
      return Promise.resolve(null);
    });

    const res = await client.get('/api/v1/referrals/my-code', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { code: ReferralCode };
    expect(body.code.code).toBe('WPABCD1234');
    expect(body.code.userId).toBe('user-referrer');
  });

  it('generates new code if user has none', async () => {
    const token = makeToken('user-new-referrer');
    const res = await client.get('/api/v1/referrals/my-code', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { code: ReferralCode };
    expect(body.code.code).toMatch(/^WP[0-9A-F]{8}$/);
    expect(body.code.active).toBe(true);
    expect(body.code.maxUses).toBe(50);
  });

  it('returns 401 without token', async () => {
    const res = await client.get('/api/v1/referrals/my-code');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/v1/referrals/stats ────────────────────────

describe('GET /api/v1/referrals/stats', () => {
  it('returns stats with no referrals', async () => {
    const token = makeToken('user-no-refs');
    const res = await client.get('/api/v1/referrals/stats', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { code: string | null; stats: { totalReferrals: number; totalEarned: number }; referrals: unknown[] };
    expect(body.code).toBeNull();
    expect(body.stats.totalReferrals).toBe(0);
    expect(body.stats.totalEarned).toBe(0);
    expect(body.referrals).toEqual([]);
  });

  it('returns stats with completed referrals', async () => {
    const token = makeToken('user-referrer');
    const completedRef: Referral = { ...sampleReferral, status: 'completed', completedAt: '2026-01-20T00:00:00.000Z' };

    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'referral:user:user-referrer') return Promise.resolve('WPABCD1234');
      if (key === 'referral:code:WPABCD1234') return Promise.resolve(JSON.stringify(sampleCode));
      if (key === 'referral:list:user-referrer') return Promise.resolve(JSON.stringify(['ref_abc123']));
      if (key === 'referral:entry:ref_abc123') return Promise.resolve(JSON.stringify(completedRef));
      return Promise.resolve(null);
    });

    const res = await client.get('/api/v1/referrals/stats', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { code: string; stats: { totalReferrals: number; completedReferrals: number; totalEarned: number } };
    expect(body.code).toBe('WPABCD1234');
    expect(body.stats.totalReferrals).toBe(1);
    expect(body.stats.completedReferrals).toBe(1);
    expect(body.stats.totalEarned).toBe(1000);
  });

  it('returns 401 without token', async () => {
    const res = await client.get('/api/v1/referrals/stats');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/v1/referrals/apply ───────────────────────

describe('POST /api/v1/referrals/apply', () => {
  it('applies a valid referral code', async () => {
    const token = makeToken('user-new');
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'referral:code:WPABCD1234') return Promise.resolve(JSON.stringify(sampleCode));
      return Promise.resolve(null);
    });

    const res = await client.post('/api/v1/referrals/apply', {
      headers: { Authorization: `Bearer ${token}` },
      body: { code: 'WPABCD1234' },
    });
    expect(res.status).toBe(200);
    const body = res.body as { message: string; referral: Referral };
    expect(body.message).toContain('exitosamente');
    expect(body.referral.referrerId).toBe('user-referrer');
    expect(body.referral.status).toBe('pending');
  });

  it('upcases code before lookup', async () => {
    const token = makeToken('user-new');
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'referral:code:WPABCD1234') return Promise.resolve(JSON.stringify(sampleCode));
      return Promise.resolve(null);
    });

    const res = await client.post('/api/v1/referrals/apply', {
      headers: { Authorization: `Bearer ${token}` },
      body: { code: 'wpabcd1234' },
    });
    expect(res.status).toBe(200);
  });

  it('returns 409 for unknown code', async () => {
    const token = makeToken('user-new');
    const res = await client.post('/api/v1/referrals/apply', {
      headers: { Authorization: `Bearer ${token}` },
      body: { code: 'WPINVALID' },
    });
    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toContain('no encontrado');
  });

  it('returns 409 for self-referral', async () => {
    const token = makeToken('user-referrer');  // same as sampleCode.userId
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'referral:code:WPABCD1234') return Promise.resolve(JSON.stringify(sampleCode));
      return Promise.resolve(null);
    });

    const res = await client.post('/api/v1/referrals/apply', {
      headers: { Authorization: `Bearer ${token}` },
      body: { code: 'WPABCD1234' },
    });
    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toContain('propio código');
  });

  it('returns 409 when user already used a referral', async () => {
    const token = makeToken('already-referred');
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'referral:code:WPABCD1234') return Promise.resolve(JSON.stringify(sampleCode));
      if (key === 'referral:referred-by:already-referred') return Promise.resolve('ref_old');
      return Promise.resolve(null);
    });

    const res = await client.post('/api/v1/referrals/apply', {
      headers: { Authorization: `Bearer ${token}` },
      body: { code: 'WPABCD1234' },
    });
    expect(res.status).toBe(409);
  });

  it('returns 400 for missing code', async () => {
    const token = makeToken('user-new');
    const res = await client.post('/api/v1/referrals/apply', {
      headers: { Authorization: `Bearer ${token}` },
      body: {},
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 without token', async () => {
    const res = await client.post('/api/v1/referrals/apply', {
      body: { code: 'WPABCD1234' },
    });
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/v1/referrals/validate/:code ───────────────

describe('GET /api/v1/referrals/validate/:code', () => {
  it('returns valid=true for active code', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(sampleCode));

    const res = await client.get('/api/v1/referrals/validate/WPABCD1234');
    expect(res.status).toBe(200);
    const body = res.body as { valid: boolean; rewardForReferred: number; message: string };
    expect(body.valid).toBe(true);
    expect(body.rewardForReferred).toBe(500);
    expect(body.message).toContain('500');
  });

  it('upcases code before lookup', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(sampleCode));

    const res = await client.get('/api/v1/referrals/validate/wpabcd1234');
    expect(res.status).toBe(200);
    expect((res.body as { valid: boolean }).valid).toBe(true);
  });

  it('returns 404 for unknown code', async () => {
    const res = await client.get('/api/v1/referrals/validate/WPINVALID');
    expect(res.status).toBe(404);
    expect((res.body as { valid: boolean }).valid).toBe(false);
  });

  it('returns 404 for inactive code', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ ...sampleCode, active: false }));

    const res = await client.get('/api/v1/referrals/validate/WPABCD1234');
    expect(res.status).toBe(404);
    expect((res.body as { valid: boolean }).valid).toBe(false);
  });

  it('returns 404 when max uses reached', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ ...sampleCode, usageCount: 50 }));

    const res = await client.get('/api/v1/referrals/validate/WPABCD1234');
    expect(res.status).toBe(404);
    expect((res.body as { valid: boolean }).valid).toBe(false);
  });
});
