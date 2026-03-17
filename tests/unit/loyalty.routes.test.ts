/**
 * Route-level tests for loyalty.routes.ts
 * Covers: GET /loyalty/account, GET /loyalty/history,
 *         GET /loyalty/rewards, POST /loyalty/redeem
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
import type { LoyaltyAccount, PointsTransaction, RewardItem } from '../../src/services/loyalty.service';

const JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
const makeToken = (userId: string) =>
  jwt.sign(
    { userId, waId: '56912345678', kycLevel: 'BASIC' },
    JWT_SECRET,
    { expiresIn: '30m', issuer: 'whatpay', audience: 'whatpay-api' },
  );

let client: TestClient;

const sampleAccount: LoyaltyAccount = {
  userId: 'user-1',
  points: 1250,
  lifetimePoints: 3500,
  tier: 'PLATA',
  lastEarnedAt: '2026-03-01T10:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const sampleHistory: PointsTransaction[] = [
  {
    id: 'lpt_abc1', userId: 'user-1', type: 'earn', points: 150,
    description: 'Pago a Juan', reference: '#WP-2026-ABC',
    createdAt: '2026-03-10T12:00:00.000Z',
  },
  {
    id: 'lpt_abc2', userId: 'user-1', type: 'redeem', points: 500,
    description: 'Canje de puntos', reference: null,
    createdAt: '2026-03-15T09:00:00.000Z',
  },
];

const sampleRewards: RewardItem[] = [
  {
    id: 'rwd_001', name: 'Descuento $500', description: 'Descuento directo en tu próximo pago',
    pointsCost: 1000, category: 'descuento', active: true,
  },
  {
    id: 'rwd_002', name: 'Sin comisión', description: 'Próxima transferencia sin comisión',
    pointsCost: 2000, category: 'beneficio', active: true,
  },
];

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

// ─── GET /api/v1/loyalty/account ────────────────────────

describe('GET /api/v1/loyalty/account', () => {
  it('returns existing account with tier info', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockResolvedValue(JSON.stringify(sampleAccount));

    const res = await client.get('/api/v1/loyalty/account', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { account: LoyaltyAccount; tierInfo: { current: string; nextTier: string | null; pointsToNext: number } };
    expect(body.account.points).toBe(1250);
    expect(body.account.tier).toBe('PLATA');
    expect(body.tierInfo.current).toBe('PLATA');
    expect(body.tierInfo.nextTier).toBe('ORO');
    expect(body.tierInfo.pointsToNext).toBe(21500); // 25000 - 3500
  });

  it('returns default BRONCE account for new user', async () => {
    const token = makeToken('new-user');
    const res = await client.get('/api/v1/loyalty/account', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { account: LoyaltyAccount; tierInfo: { current: string } };
    expect(body.account.tier).toBe('BRONCE');
    expect(body.account.points).toBe(0);
    expect(body.tierInfo.current).toBe('BRONCE');
  });

  it('returns PLATINO with no next tier', async () => {
    const token = makeToken('platinum-user');
    const platAccount: LoyaltyAccount = { ...sampleAccount, tier: 'PLATINO', lifetimePoints: 150000 };
    mockRedisGet.mockResolvedValue(JSON.stringify(platAccount));

    const res = await client.get('/api/v1/loyalty/account', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { tierInfo: { nextTier: string | null; pointsToNext: number } };
    expect(body.tierInfo.nextTier).toBeNull();
    expect(body.tierInfo.pointsToNext).toBe(0);
  });

  it('returns 401 without token', async () => {
    const res = await client.get('/api/v1/loyalty/account');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/v1/loyalty/history ────────────────────────

describe('GET /api/v1/loyalty/history', () => {
  it('returns transaction history', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'loyalty:history:user-1') return Promise.resolve(JSON.stringify(sampleHistory));
      return Promise.resolve(null);
    });

    const res = await client.get('/api/v1/loyalty/history', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { history: PointsTransaction[]; count: number };
    expect(body.count).toBe(2);
    expect(body.history[0].type).toBe('earn');
    expect(body.history[1].type).toBe('redeem');
  });

  it('returns empty history for new user', async () => {
    const token = makeToken('new-user');
    const res = await client.get('/api/v1/loyalty/history', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { count: number };
    expect(body.count).toBe(0);
  });

  it('respects limit query param', async () => {
    const token = makeToken('user-1');
    const manyTxns = Array.from({ length: 50 }, (_, i) => ({
      id: `lpt_${i}`, userId: 'user-1', type: 'earn' as const,
      points: 10, description: 'test', reference: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    }));
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'loyalty:history:user-1') return Promise.resolve(JSON.stringify(manyTxns));
      return Promise.resolve(null);
    });

    const res = await client.get('/api/v1/loyalty/history?limit=5', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect((res.body as { count: number }).count).toBeLessThanOrEqual(5);
  });

  it('returns 401 without token', async () => {
    const res = await client.get('/api/v1/loyalty/history');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/v1/loyalty/rewards ────────────────────────

describe('GET /api/v1/loyalty/rewards', () => {
  it('returns rewards catalog (public, no auth required)', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(sampleRewards));

    const res = await client.get('/api/v1/loyalty/rewards');
    expect(res.status).toBe(200);
    const body = res.body as { rewards: RewardItem[] };
    expect(body.rewards).toHaveLength(2);
    expect(body.rewards[0].pointsCost).toBe(1000);
  });

  it('returns empty array when no rewards configured', async () => {
    const res = await client.get('/api/v1/loyalty/rewards');
    expect(res.status).toBe(200);
    expect((res.body as { rewards: unknown[] }).rewards).toEqual([]);
  });

  it('filters out inactive rewards', async () => {
    const withInactive = [
      ...sampleRewards,
      { id: 'rwd_003', name: 'Old reward', description: '', pointsCost: 500, category: 'test', active: false },
    ];
    mockRedisGet.mockResolvedValue(JSON.stringify(withInactive));

    const res = await client.get('/api/v1/loyalty/rewards');
    expect(res.status).toBe(200);
    const body = res.body as { rewards: RewardItem[] };
    expect(body.rewards.every((r) => r.active)).toBe(true);
    expect(body.rewards).toHaveLength(2);
  });
});

// ─── POST /api/v1/loyalty/redeem ────────────────────────

describe('POST /api/v1/loyalty/redeem', () => {
  it('redeems points successfully', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockResolvedValue(JSON.stringify(sampleAccount)); // 1250 points

    const res = await client.post('/api/v1/loyalty/redeem', {
      headers: { Authorization: `Bearer ${token}` },
      body: { points: 500, description: 'Premio' },
    });
    expect(res.status).toBe(200);
    const body = res.body as { message: string; remaining: number };
    expect(body.remaining).toBe(750); // 1250 - 500
    expect(body.message).toBeDefined();
  });

  it('rejects when insufficient points', async () => {
    const token = makeToken('user-1');
    const poorAccount: LoyaltyAccount = { ...sampleAccount, points: 100 };
    mockRedisGet.mockResolvedValue(JSON.stringify(poorAccount));

    const res = await client.post('/api/v1/loyalty/redeem', {
      headers: { Authorization: `Bearer ${token}` },
      body: { points: 500 },
    });
    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toBeDefined();
  });

  it('returns 400 for invalid points (zero)', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/loyalty/redeem', {
      headers: { Authorization: `Bearer ${token}` },
      body: { points: 0 },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing body', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/loyalty/redeem', {
      headers: { Authorization: `Bearer ${token}` },
      body: {},
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 without token', async () => {
    const res = await client.post('/api/v1/loyalty/redeem', {
      body: { points: 100 },
    });
    expect(res.status).toBe(401);
  });
});
