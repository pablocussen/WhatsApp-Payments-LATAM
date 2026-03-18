/**
 * Route-level tests for dispute.routes.ts
 * Covers: POST /disputes, GET /disputes, GET /disputes/:id,
 *         POST /admin/disputes/:id/status
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
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
    incr: (...args: unknown[]) => mockRedisIncr(...args),
    sAdd: jest.fn(),
    sRem: jest.fn(),
    sMembers: jest.fn(),
    sCard: jest.fn(),
    lPush: jest.fn(),
    lRange: jest.fn().mockResolvedValue([]),
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
import type { Dispute } from '../../src/services/dispute.service';

const JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
const ADMIN_KEY = 'test-admin-key-at-least-32-characters-long';
const makeToken = (userId: string) =>
  jwt.sign(
    { userId, waId: '56912345678', kycLevel: 'BASIC' },
    JWT_SECRET,
    { expiresIn: '30m', issuer: 'whatpay', audience: 'whatpay-api' },
  );

let client: TestClient;

const now = new Date().toISOString();
const sampleDispute: Dispute = {
  id: 'dsp_test001',
  transactionRef: '#WP-2026-ABC',
  openedBy: 'user-1',
  merchantId: null,
  reason: 'unauthorized',
  description: 'No reconozco este cobro',
  status: 'open',
  resolution: null,
  createdAt: now,
  updatedAt: now,
  resolvedAt: null,
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
  mockRedisIncr.mockResolvedValue(1);
});

// ─── POST /api/v1/disputes ──────────────────────────────

describe('POST /api/v1/disputes', () => {
  it('opens a new dispute (auth required)', async () => {
    const token = makeToken('user-1');
    // getUserDisputes returns empty (no existing disputes)
    mockRedisGet.mockResolvedValue(null);

    const res = await client.post('/api/v1/disputes', {
      headers: { Authorization: `Bearer ${token}` },
      body: {
        transactionRef: '#WP-2026-XYZ',
        reason: 'unauthorized',
        description: 'No reconozco este cobro de 5000 CLP',
      },
    });
    expect(res.status).toBe(201);
    const body = res.body as { dispute: Dispute };
    expect(body.dispute.id).toMatch(/^dsp_/);
    expect(body.dispute.reason).toBe('unauthorized');
    expect(body.dispute.status).toBe('open');
  });

  it('returns 400 for invalid reason', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/disputes', {
      headers: { Authorization: `Bearer ${token}` },
      body: {
        transactionRef: '#WP-2026-XYZ',
        reason: 'invalid_reason',
        description: 'test',
      },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing fields', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/disputes', {
      headers: { Authorization: `Bearer ${token}` },
      body: { reason: 'other' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 without token', async () => {
    const res = await client.post('/api/v1/disputes', {
      body: { transactionRef: 'X', reason: 'other', description: 'test' },
    });
    expect(res.status).toBe(401);
  });

  it('returns 409 for duplicate dispute on same transaction', async () => {
    const token = makeToken('user-1');
    // User already has an open dispute for this transaction
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'dispute:user:user-1') return Promise.resolve(JSON.stringify(['dsp_test001']));
      if (key === 'dispute:dsp_test001') return Promise.resolve(JSON.stringify(sampleDispute));
      return Promise.resolve(null);
    });

    const res = await client.post('/api/v1/disputes', {
      headers: { Authorization: `Bearer ${token}` },
      body: {
        transactionRef: '#WP-2026-ABC', // same as sampleDispute
        reason: 'duplicate',
        description: 'Duplicado',
      },
    });
    expect(res.status).toBe(409);
  });
});

// ─── GET /api/v1/disputes ───────────────────────────────

describe('GET /api/v1/disputes', () => {
  it('returns user disputes', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'dispute:user:user-1') return Promise.resolve(JSON.stringify(['dsp_test001']));
      if (key === 'dispute:dsp_test001') return Promise.resolve(JSON.stringify(sampleDispute));
      return Promise.resolve(null);
    });

    const res = await client.get('/api/v1/disputes', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { disputes: Dispute[]; count: number };
    expect(body.count).toBe(1);
    expect(body.disputes[0].reason).toBe('unauthorized');
  });

  it('returns empty for new user', async () => {
    const token = makeToken('new-user');
    const res = await client.get('/api/v1/disputes', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect((res.body as { count: number }).count).toBe(0);
  });

  it('returns 401 without token', async () => {
    const res = await client.get('/api/v1/disputes');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/v1/disputes/:id ───────────────────────────

describe('GET /api/v1/disputes/:id', () => {
  it('returns dispute detail for owner', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'dispute:dsp_test001') return Promise.resolve(JSON.stringify(sampleDispute));
      return Promise.resolve(null);
    });

    const res = await client.get('/api/v1/disputes/dsp_test001', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect((res.body as { dispute: Dispute }).dispute.id).toBe('dsp_test001');
  });

  it('returns 403 for non-owner', async () => {
    const token = makeToken('other-user');
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'dispute:dsp_test001') return Promise.resolve(JSON.stringify(sampleDispute));
      return Promise.resolve(null);
    });

    const res = await client.get('/api/v1/disputes/dsp_test001', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown dispute', async () => {
    const token = makeToken('user-1');
    const res = await client.get('/api/v1/disputes/dsp_unknown', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/v1/admin/disputes/:id/status ─────────────

describe('POST /api/v1/admin/disputes/:id/status', () => {
  it('updates status with admin key', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'dispute:dsp_test001') return Promise.resolve(JSON.stringify(sampleDispute));
      return Promise.resolve(null);
    });

    const res = await client.post('/api/v1/admin/disputes/dsp_test001/status', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { status: 'under_review' },
    });
    expect(res.status).toBe(200);
    expect((res.body as { dispute: Dispute }).dispute.status).toBe('under_review');
  });

  it('resolves in favor of customer', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'dispute:dsp_test001') return Promise.resolve(JSON.stringify(sampleDispute));
      return Promise.resolve(null);
    });

    const res = await client.post('/api/v1/admin/disputes/dsp_test001/status', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { status: 'resolved_favor_customer', resolution: 'Reembolso procesado' },
    });
    expect(res.status).toBe(200);
    const body = res.body as { dispute: Dispute };
    expect(body.dispute.status).toBe('resolved_favor_customer');
    expect(body.dispute.resolution).toBe('Reembolso procesado');
  });

  it('returns 404 for unknown dispute', async () => {
    const res = await client.post('/api/v1/admin/disputes/dsp_unknown/status', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { status: 'under_review' },
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid status', async () => {
    const res = await client.post('/api/v1/admin/disputes/dsp_test001/status', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { status: 'invalid' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.post('/api/v1/admin/disputes/dsp_test001/status', {
      body: { status: 'under_review' },
    });
    expect(res.status).toBe(401);
  });
});
