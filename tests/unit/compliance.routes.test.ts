/**
 * Route-level tests for compliance.routes.ts
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisIncr = jest.fn().mockResolvedValue(1);
const mockRedisLRange = jest.fn().mockResolvedValue([]);
const mockRedisDel = jest.fn().mockResolvedValue(1);
const mockRedisMulti = jest.fn();

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
    incr: (...args: unknown[]) => mockRedisIncr(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
    lRange: (...args: unknown[]) => mockRedisLRange(...args),
    lPush: jest.fn(), lTrim: jest.fn(),
    multi: () => mockRedisMulti(),
    sAdd: jest.fn(), sRem: jest.fn(), sMembers: jest.fn(), sCard: jest.fn(),
    expire: jest.fn().mockResolvedValue(true), ping: jest.fn().mockResolvedValue('PONG'),
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
import type { ComplianceEntry, ComplianceStats } from '../../src/services/compliance-log.service';

const ADMIN_KEY = 'test-admin-key-at-least-32-characters-long';
let client: TestClient;

const sampleEntry: ComplianceEntry = {
  id: 'cmp_test001', action: 'LARGE_TRANSFER', severity: 'high',
  userId: 'user-1', transactionRef: '#WP-2026-ABC', amount: 5000000,
  description: 'Transferencia sobre umbral', reviewed: false,
  reviewedBy: null, reviewedAt: null, timestamp: new Date().toISOString(),
};

const sampleStats: ComplianceStats = {
  total: 10, pending: 3,
  bySeverity: { low: 4, medium: 2, high: 3, critical: 1 },
};

beforeAll(async () => {
  const { default: app } = await import('../../src/api/server');
  client = await startTestServer(app);
});
afterAll(async () => { await client.close(); });
beforeEach(() => {
  jest.clearAllMocks();
  mockRedisGet.mockResolvedValue(null);
  mockRedisLRange.mockResolvedValue([]);
  mockRedisSet.mockResolvedValue('OK');
  mockRedisDel.mockResolvedValue(1);
  mockRedisMulti.mockReturnValue({
    del: jest.fn().mockReturnThis(),
    lPush: jest.fn().mockReturnThis(),
    lTrim: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([]),
  });
});

describe('GET /api/v1/admin/compliance', () => {
  it('returns global compliance log', async () => {
    mockRedisLRange.mockResolvedValue([JSON.stringify(sampleEntry)]);
    const res = await client.get('/api/v1/admin/compliance', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    const body = res.body as { entries: ComplianceEntry[]; count: number };
    expect(body.count).toBe(1);
    expect(body.entries[0].action).toBe('LARGE_TRANSFER');
  });

  it('returns empty when no entries', async () => {
    const res = await client.get('/api/v1/admin/compliance', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    expect((res.body as { count: number }).count).toBe(0);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.get('/api/v1/admin/compliance');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/v1/admin/compliance/stats', () => {
  it('returns compliance stats', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(sampleStats));
    const res = await client.get('/api/v1/admin/compliance/stats', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    const body = res.body as { stats: ComplianceStats };
    expect(body.stats.total).toBe(10);
    expect(body.stats.pending).toBe(3);
    expect(body.stats.bySeverity.critical).toBe(1);
  });

  it('returns zeros for no data', async () => {
    const res = await client.get('/api/v1/admin/compliance/stats', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    expect((res.body as { stats: ComplianceStats }).stats.total).toBe(0);
  });
});

describe('GET /api/v1/admin/compliance/user/:userId', () => {
  it('returns user compliance log', async () => {
    mockRedisLRange.mockResolvedValue([JSON.stringify(sampleEntry)]);
    const res = await client.get('/api/v1/admin/compliance/user/user-1', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    expect((res.body as { count: number }).count).toBe(1);
  });

  it('returns empty for clean user', async () => {
    const res = await client.get('/api/v1/admin/compliance/user/clean-user', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    expect((res.body as { count: number }).count).toBe(0);
  });
});

describe('POST /api/v1/admin/compliance/:entryId/review', () => {
  it('marks entry as reviewed', async () => {
    mockRedisLRange.mockResolvedValue([JSON.stringify(sampleEntry)]);
    const res = await client.post('/api/v1/admin/compliance/cmp_test001/review', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { userId: 'user-1' },
    });
    expect(res.status).toBe(200);
    expect((res.body as { message: string }).message).toContain('revisada');
  });

  it('returns 400 without userId', async () => {
    const res = await client.post('/api/v1/admin/compliance/cmp_test001/review', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: {},
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown entry', async () => {
    const res = await client.post('/api/v1/admin/compliance/cmp_unknown/review', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { userId: 'user-1' },
    });
    expect(res.status).toBe(404);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.post('/api/v1/admin/compliance/cmp_test001/review', {
      body: { userId: 'user-1' },
    });
    expect(res.status).toBe(401);
  });
});
