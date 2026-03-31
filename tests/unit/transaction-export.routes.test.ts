/**
 * Route-level tests for transaction-export.routes.ts
 * Covers: POST /admin/exports, GET /:id, GET /user/:userId, GET /columns
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
    expire: jest.fn().mockResolvedValue(true), ping: jest.fn().mockResolvedValue('PONG'),
    multi: jest.fn().mockReturnValue({
      incrBy: jest.fn().mockReturnThis(), incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(), sAdd: jest.fn().mockReturnThis(),
      del: jest.fn().mockReturnThis(), lPush: jest.fn().mockReturnThis(),
      lTrim: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
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
import type { ExportJob, ExportColumn } from '../../src/services/transaction-export.service';

const ADMIN_KEY = 'test-admin-key-at-least-32-characters-long';
let client: TestClient;

const now = new Date();
const expires = new Date(now);
expires.setDate(expires.getDate() + 7);

const sampleJob: ExportJob = {
  id: 'exp_test001',
  requestedBy: 'admin',
  format: 'csv',
  filters: {},
  status: 'pending',
  totalRecords: 0,
  fileUrl: null,
  fileSize: null,
  errorMessage: null,
  createdAt: now.toISOString(),
  completedAt: null,
  expiresAt: expires.toISOString(),
};

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

// ─── POST /api/v1/admin/exports ───────────────────────────

describe('POST /api/v1/admin/exports', () => {
  it('creates an export job and returns 201 with id matching /^exp_/', async () => {
    const res = await client.post('/api/v1/admin/exports', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: {
        requestedBy: 'admin',
        format: 'csv',
      },
    });
    expect(res.status).toBe(201);
    const body = res.body as { job: ExportJob };
    expect(body.job.id).toMatch(/^exp_/);
    expect(body.job.requestedBy).toBe('admin');
    expect(body.job.format).toBe('csv');
    expect(body.job.status).toBe('pending');
    expect(body.job.totalRecords).toBe(0);
    expect(body.job.fileUrl).toBeNull();
    expect(body.job.completedAt).toBeNull();
    expect(body.job.expiresAt).toBeDefined();
  });

  it('creates export with filters', async () => {
    const res = await client.post('/api/v1/admin/exports', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: {
        requestedBy: 'admin',
        format: 'json',
        filters: {
          userId: 'user-1',
          status: 'completed',
          dateFrom: '2026-03-01',
          dateTo: '2026-03-31',
        },
      },
    });
    expect(res.status).toBe(201);
    const body = res.body as { job: ExportJob };
    expect(body.job.format).toBe('json');
    expect(body.job.filters).toHaveProperty('userId', 'user-1');
  });

  it('returns 400 for invalid format', async () => {
    const res = await client.post('/api/v1/admin/exports', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: {
        requestedBy: 'admin',
        format: 'xml',
      },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing requestedBy', async () => {
    const res = await client.post('/api/v1/admin/exports', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { format: 'csv' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.post('/api/v1/admin/exports', {
      body: { requestedBy: 'admin', format: 'csv' },
    });
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/v1/admin/exports/:id ────────────────────────

describe('GET /api/v1/admin/exports/:id', () => {
  it('returns saved export job', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'export:job:exp_test001') return Promise.resolve(JSON.stringify(sampleJob));
      return Promise.resolve(null);
    });

    const res = await client.get('/api/v1/admin/exports/exp_test001', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    const body = res.body as { job: ExportJob };
    expect(body.job.id).toBe('exp_test001');
    expect(body.job.requestedBy).toBe('admin');
    expect(body.job.format).toBe('csv');
    expect(body.job.status).toBe('pending');
  });

  it('returns 404 for unknown job', async () => {
    const res = await client.get('/api/v1/admin/exports/exp_unknown', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(404);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.get('/api/v1/admin/exports/exp_test001');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/v1/admin/exports/user/:userId ───────────────

describe('GET /api/v1/admin/exports/user/:userId', () => {
  it('returns list of user export jobs', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'export:user-jobs:admin') return Promise.resolve(JSON.stringify(['exp_test001']));
      if (key === 'export:job:exp_test001') return Promise.resolve(JSON.stringify(sampleJob));
      return Promise.resolve(null);
    });

    const res = await client.get('/api/v1/admin/exports/user/admin', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    const body = res.body as { jobs: ExportJob[] };
    expect(Array.isArray(body.jobs)).toBe(true);
    expect(body.jobs.length).toBe(1);
    expect(body.jobs[0].id).toBe('exp_test001');
  });

  it('returns empty list for user with no jobs', async () => {
    const res = await client.get('/api/v1/admin/exports/user/nobody', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    const body = res.body as { jobs: ExportJob[] };
    expect(body.jobs).toHaveLength(0);
  });
});

// ─── GET /api/v1/admin/exports/columns ────────────────────

describe('GET /api/v1/admin/exports/columns', () => {
  it('returns array of ExportColumn objects', async () => {
    const res = await client.get('/api/v1/admin/exports/columns', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    const body = res.body as { columns: ExportColumn[] };
    expect(Array.isArray(body.columns)).toBe(true);
    expect(body.columns.length).toBeGreaterThanOrEqual(1);
    expect(body.columns[0]).toHaveProperty('key');
    expect(body.columns[0]).toHaveProperty('label');
  });

  it('returns 401 without admin key', async () => {
    const res = await client.get('/api/v1/admin/exports/columns');
    expect(res.status).toBe(401);
  });
});
