/**
 * Route-level tests for scheduled-reports.routes.ts
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
    sAdd: jest.fn(), sRem: jest.fn(), sMembers: jest.fn(), sCard: jest.fn(),
    lPush: jest.fn(), lRange: jest.fn().mockResolvedValue([]),
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
import type { ScheduledReport } from '../../src/services/scheduled-reports.service';

const ADMIN_KEY = 'test-admin-key-at-least-32-characters-long';
let client: TestClient;

const sampleReport: ScheduledReport = {
  id: 'rpt_test001', merchantId: 'merchant-1', name: 'Reporte diario',
  type: 'transactions', frequency: 'daily', format: 'csv',
  recipients: ['admin@test.cl'], filters: {}, active: true,
  lastRunAt: null, nextRunAt: new Date().toISOString(), createdAt: new Date().toISOString(),
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

describe('GET /api/v1/admin/reports', () => {
  it('returns merchant reports', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'reports:merchant:merchant-1') return Promise.resolve(JSON.stringify(['rpt_test001']));
      if (key === 'reports:rpt_test001') return Promise.resolve(JSON.stringify(sampleReport));
      return Promise.resolve(null);
    });
    const res = await client.get('/api/v1/admin/reports?merchantId=merchant-1', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    expect((res.body as { count: number }).count).toBe(1);
  });

  it('returns 400 without merchantId', async () => {
    const res = await client.get('/api/v1/admin/reports', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.get('/api/v1/admin/reports?merchantId=x');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/admin/reports', () => {
  it('creates a report', async () => {
    const res = await client.post('/api/v1/admin/reports', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: {
        merchantId: 'merchant-1', name: 'Ventas semanales', type: 'revenue',
        frequency: 'weekly', recipients: ['cfo@test.cl'],
      },
    });
    expect(res.status).toBe(201);
    expect((res.body as { report: ScheduledReport }).report.id).toMatch(/^rpt_/);
  });

  it('returns 400 for invalid type', async () => {
    const res = await client.post('/api/v1/admin/reports', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { merchantId: 'x', name: 'T', type: 'invalid', frequency: 'daily', recipients: ['a@b.cl'] },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing recipients', async () => {
    const res = await client.post('/api/v1/admin/reports', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { merchantId: 'x', name: 'T', type: 'users', frequency: 'daily', recipients: [] },
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/admin/reports/:id', () => {
  it('returns report detail', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(sampleReport));
    const res = await client.get('/api/v1/admin/reports/rpt_test001', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    expect((res.body as { report: ScheduledReport }).report.name).toBe('Reporte diario');
  });

  it('returns 404 for unknown report', async () => {
    const res = await client.get('/api/v1/admin/reports/rpt_unknown', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/v1/admin/reports/:id/update', () => {
  it('updates frequency', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(sampleReport));
    const res = await client.post('/api/v1/admin/reports/rpt_test001/update', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { frequency: 'monthly' },
    });
    expect(res.status).toBe(200);
    expect((res.body as { report: ScheduledReport }).report.frequency).toBe('monthly');
  });

  it('pauses a report', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(sampleReport));
    const res = await client.post('/api/v1/admin/reports/rpt_test001/update', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { active: false },
    });
    expect(res.status).toBe(200);
    expect((res.body as { report: ScheduledReport }).report.active).toBe(false);
  });
});

describe('DELETE /api/v1/admin/reports/:id', () => {
  it('deletes a report', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'reports:rpt_test001') return Promise.resolve(JSON.stringify(sampleReport));
      if (key === 'reports:merchant:merchant-1') return Promise.resolve(JSON.stringify(['rpt_test001']));
      return Promise.resolve(null);
    });
    mockRedisDel.mockResolvedValue(1);
    const res = await client.delete('/api/v1/admin/reports/rpt_test001', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    expect((res.body as { message: string }).message).toContain('eliminado');
  });

  it('returns 404 for unknown report', async () => {
    const res = await client.delete('/api/v1/admin/reports/rpt_unknown', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/admin/reports/:id/executions', () => {
  it('returns execution history', async () => {
    const res = await client.get('/api/v1/admin/reports/rpt_test001/executions', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    expect((res.body as { count: number }).count).toBe(0);
  });
});
