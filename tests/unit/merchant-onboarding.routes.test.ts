/**
 * Route-level tests for merchant-onboarding.routes.ts
 * Covers: POST /merchants/apply, GET /merchants/application,
 *         GET /admin/merchants/queue, GET /admin/merchants/applications/:id,
 *         POST /admin/merchants/applications/:id/review,
 *         POST /admin/merchants/applications/:id/suspend
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisIncr = jest.fn().mockResolvedValue(1);
const mockRedisLPush = jest.fn().mockResolvedValue(1);
const mockRedisLRange = jest.fn().mockResolvedValue([]);

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
    lPush: (...args: unknown[]) => mockRedisLPush(...args),
    lRange: (...args: unknown[]) => mockRedisLRange(...args),
    sAdd: jest.fn(),
    sRem: jest.fn(),
    sMembers: jest.fn(),
    sCard: jest.fn(),
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
import type { MerchantApplication } from '../../src/services/merchant-onboarding.service';

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
const sampleApp: MerchantApplication = {
  id: 'mapp_test001',
  userId: 'user-1',
  businessName: 'Café Central',
  businessType: 'individual',
  rut: '12345678-9',
  contactEmail: 'cafe@test.cl',
  contactPhone: '+56912345678',
  category: 'food',
  description: 'Café y pastelería artesanal',
  status: 'pending',
  reviewNotes: null,
  approvedAt: null,
  createdAt: now,
  updatedAt: now,
};

const approvedApp: MerchantApplication = {
  ...sampleApp,
  status: 'approved',
  approvedAt: now,
};

const validApplication = {
  businessName: 'Tienda Online',
  businessType: 'company',
  rut: '76543210-K',
  contactEmail: 'info@tienda.cl',
  contactPhone: '+56987654321',
  category: 'retail',
  description: 'Tienda de ropa y accesorios',
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
  mockRedisLPush.mockResolvedValue(1);
  mockRedisLRange.mockResolvedValue([]);
});

// ─── POST /api/v1/merchants/apply ───────────────────────

describe('POST /api/v1/merchants/apply', () => {
  it('submits an application (auth required)', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/merchants/apply', {
      headers: { Authorization: `Bearer ${token}` },
      body: validApplication,
    });
    expect(res.status).toBe(201);
    const body = res.body as { application: MerchantApplication };
    expect(body.application.id).toMatch(/^mapp_/);
    expect(body.application.businessName).toBe('Tienda Online');
    expect(body.application.status).toBe('pending');
  });

  it('returns 409 for duplicate application', async () => {
    const token = makeToken('user-1');
    // User already has a pending application
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'merchant:user:user-1') return Promise.resolve('mapp_test001');
      if (key === 'merchant:app:mapp_test001') return Promise.resolve(JSON.stringify(sampleApp));
      return Promise.resolve(null);
    });

    const res = await client.post('/api/v1/merchants/apply', {
      headers: { Authorization: `Bearer ${token}` },
      body: validApplication,
    });
    expect(res.status).toBe(409);
  });

  it('returns 400 for invalid RUT', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/merchants/apply', {
      headers: { Authorization: `Bearer ${token}` },
      body: { ...validApplication, rut: 'INVALID' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid category', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/merchants/apply', {
      headers: { Authorization: `Bearer ${token}` },
      body: { ...validApplication, category: 'crypto' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing fields', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/merchants/apply', {
      headers: { Authorization: `Bearer ${token}` },
      body: { businessName: 'X' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 without token', async () => {
    const res = await client.post('/api/v1/merchants/apply', {
      body: validApplication,
    });
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/v1/merchants/application ──────────────────

describe('GET /api/v1/merchants/application', () => {
  it('returns user application', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'merchant:user:user-1') return Promise.resolve('mapp_test001');
      if (key === 'merchant:app:mapp_test001') return Promise.resolve(JSON.stringify(sampleApp));
      return Promise.resolve(null);
    });

    const res = await client.get('/api/v1/merchants/application', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect((res.body as { application: MerchantApplication }).application.businessName).toBe('Café Central');
  });

  it('returns 404 for user without application', async () => {
    const token = makeToken('new-user');
    const res = await client.get('/api/v1/merchants/application', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });

  it('returns 401 without token', async () => {
    const res = await client.get('/api/v1/merchants/application');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/v1/admin/merchants/queue ──────────────────

describe('GET /api/v1/admin/merchants/queue', () => {
  it('returns pending applications (admin)', async () => {
    mockRedisLRange.mockResolvedValue(['mapp_test001']);
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'merchant:app:mapp_test001') return Promise.resolve(JSON.stringify(sampleApp));
      return Promise.resolve(null);
    });

    const res = await client.get('/api/v1/admin/merchants/queue', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    const body = res.body as { queue: MerchantApplication[]; count: number };
    expect(body.count).toBe(1);
    expect(body.queue[0].businessName).toBe('Café Central');
  });

  it('returns empty queue', async () => {
    const res = await client.get('/api/v1/admin/merchants/queue', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    expect((res.body as { count: number }).count).toBe(0);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.get('/api/v1/admin/merchants/queue');
    expect(res.status).toBe(401);
  });
});

// ─── GET /admin/merchants/applications/:id ──────────────

describe('GET /api/v1/admin/merchants/applications/:id', () => {
  it('returns application detail', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'merchant:app:mapp_test001') return Promise.resolve(JSON.stringify(sampleApp));
      return Promise.resolve(null);
    });

    const res = await client.get('/api/v1/admin/merchants/applications/mapp_test001', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(200);
    expect((res.body as { application: MerchantApplication }).application.rut).toBe('12345678-9');
  });

  it('returns 404 for unknown application', async () => {
    const res = await client.get('/api/v1/admin/merchants/applications/mapp_unknown', {
      headers: { 'x-admin-key': ADMIN_KEY },
    });
    expect(res.status).toBe(404);
  });
});

// ─── POST /admin/merchants/applications/:id/review ──────

describe('POST /api/v1/admin/merchants/applications/:id/review', () => {
  it('approves an application', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'merchant:app:mapp_test001') return Promise.resolve(JSON.stringify(sampleApp));
      return Promise.resolve(null);
    });

    const res = await client.post('/api/v1/admin/merchants/applications/mapp_test001/review', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { status: 'approved', notes: 'Todo en orden' },
    });
    expect(res.status).toBe(200);
    const body = res.body as { application: MerchantApplication };
    expect(body.application.status).toBe('approved');
    expect(body.application.reviewNotes).toBe('Todo en orden');
  });

  it('rejects an application', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'merchant:app:mapp_test001') return Promise.resolve(JSON.stringify(sampleApp));
      return Promise.resolve(null);
    });

    const res = await client.post('/api/v1/admin/merchants/applications/mapp_test001/review', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { status: 'rejected', notes: 'RUT no coincide' },
    });
    expect(res.status).toBe(200);
    expect((res.body as { application: MerchantApplication }).application.status).toBe('rejected');
  });

  it('returns 404 for unknown application', async () => {
    const res = await client.post('/api/v1/admin/merchants/applications/mapp_unknown/review', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { status: 'approved' },
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 for invalid status', async () => {
    const res = await client.post('/api/v1/admin/merchants/applications/mapp_test001/review', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { status: 'maybe' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.post('/api/v1/admin/merchants/applications/mapp_test001/review', {
      body: { status: 'approved' },
    });
    expect(res.status).toBe(401);
  });
});

// ─── POST /admin/merchants/applications/:id/suspend ─────

describe('POST /api/v1/admin/merchants/applications/:id/suspend', () => {
  it('suspends an approved merchant', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'merchant:app:mapp_test001') return Promise.resolve(JSON.stringify(approvedApp));
      return Promise.resolve(null);
    });

    const res = await client.post('/api/v1/admin/merchants/applications/mapp_test001/suspend', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { reason: 'Actividad sospechosa' },
    });
    expect(res.status).toBe(200);
    expect((res.body as { application: MerchantApplication }).application.status).toBe('suspended');
  });

  it('returns 404 for non-approved merchant', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key === 'merchant:app:mapp_test001') return Promise.resolve(JSON.stringify(sampleApp)); // pending
      return Promise.resolve(null);
    });

    const res = await client.post('/api/v1/admin/merchants/applications/mapp_test001/suspend', {
      headers: { 'x-admin-key': ADMIN_KEY },
      body: { reason: 'test' },
    });
    expect(res.status).toBe(404);
  });

  it('returns 401 without admin key', async () => {
    const res = await client.post('/api/v1/admin/merchants/applications/mapp_test001/suspend', {
      body: { reason: 'test' },
    });
    expect(res.status).toBe(401);
  });
});
