/**
 * Route-level tests for platform-status.routes.ts + metrics middleware
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
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
    incr: (...args: unknown[]) => mockRedisIncr(...args),
    del: jest.fn(), sAdd: jest.fn(), sRem: jest.fn(), sMembers: jest.fn(), sCard: jest.fn(),
    lPush: jest.fn(), lRange: jest.fn().mockResolvedValue([]),
    expire: jest.fn().mockResolvedValue(true), ping: jest.fn().mockResolvedValue('PONG'),
    multi: jest.fn().mockReturnValue({
      incr: jest.fn().mockReturnThis(), incrBy: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([1, true, 1, true, 1, true, 1, true, 1, true]),
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
});

// ─── GET /api/v1/platform/info (PUBLIC) ─────────────────

describe('GET /api/v1/platform/info', () => {
  it('returns platform info without auth', async () => {
    const res = await client.get('/api/v1/platform/info');
    expect(res.status).toBe(200);
    const body = res.body as { platform: { status: string; metrics: Record<string, number> } };
    expect(body.platform.status).toBe('operational');
    expect(body.platform.metrics.totalTests).toBe(1709);
    expect(body.platform.metrics.totalServices).toBe(44);
  });

  it('includes version and region', async () => {
    const res = await client.get('/api/v1/platform/info');
    const body = res.body as { platform: { version: string; region: string } };
    expect(body.platform.region).toBe('southamerica-west1');
    expect(body.platform.version).toBeDefined();
  });

  it('includes service status', async () => {
    const res = await client.get('/api/v1/platform/info');
    const body = res.body as { platform: { services: { api: string; redis: string } } };
    expect(body.platform.services.api).toBe('up');
    expect(body.platform.services.redis).toBe('up');
  });
});

// ─── GET /api/v1/admin/platform/metrics ─────────────────

describe('GET /api/v1/admin/platform/metrics', () => {
  it('returns metrics with admin key', async () => {
    mockRedisGet.mockResolvedValue('42');
    const res = await client.get('/api/v1/admin/platform/metrics', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    const body = res.body as { metrics: { totalRequests: number; avgLatencyMs: number } };
    expect(typeof body.metrics.totalRequests).toBe('number');
    expect(typeof body.metrics.avgLatencyMs).toBe('number');
  });

  it('returns zeros when no data', async () => {
    const res = await client.get('/api/v1/admin/platform/metrics', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    const body = res.body as { metrics: { totalRequests: number } };
    expect(body.metrics.totalRequests).toBe(0);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.get('/api/v1/admin/platform/metrics');
    expect(res.status).toBe(401);
  });
});

// ─── Platform Status Service ────────────────────────────

describe('PlatformStatusService', () => {
  it('getPlatformInfo returns correct structure', async () => {
    const { platformStatus } = await import('../../src/services/platform-status.service');
    const info = platformStatus.getPlatformInfo(new Date(Date.now() - 3600000));
    expect(info.status).toBe('operational');
    expect(info.metrics.totalEndpoints).toBe(150);
    expect(info.metrics.iteration).toBe(91);
    expect(info.metrics.uptime).toContain('h');
  });
});
