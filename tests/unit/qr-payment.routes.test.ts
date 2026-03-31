/**
 * Route-level tests for qr-payment.routes.ts
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
    multi: jest.fn().mockReturnValue({
      incr: jest.fn().mockReturnThis(), incrBy: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([1, true]),
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
import jwt from 'jsonwebtoken';
import type { QrCode } from '../../src/services/qr-payment.service';

const JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
const makeToken = (userId: string) =>
  jwt.sign({ userId, waId: '56912345678', kycLevel: 'BASIC' }, JWT_SECRET,
    { expiresIn: '30m', issuer: 'whatpay', audience: 'whatpay-api' });

let client: TestClient;

const sampleQr: QrCode = {
  id: 'qr_test001', type: 'static', merchantId: null, createdBy: 'user-1',
  amount: 5000, description: 'Café', reference: 'ABC12345', status: 'active',
  scannedBy: null, transactionRef: null, expiresAt: null,
  createdAt: new Date().toISOString(), usedAt: null,
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

// ─── POST /api/v1/qr/generate ───────────────────────────

describe('POST /api/v1/qr/generate', () => {
  it('generates a static QR', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/qr/generate', {
      headers: { Authorization: `Bearer ${token}` },
      body: { type: 'static', amount: 5000, description: 'Café' },
    });
    expect(res.status).toBe(201);
    const body = res.body as { qr: QrCode; qrPayload: string; scanUrl: string };
    expect(body.qr.id).toMatch(/^qr_/);
    expect(body.qr.reference).toHaveLength(8);
    expect(body.qrPayload).toContain('/pay/');
    expect(body.scanUrl).toContain('/qr/scan/');
  });

  it('generates a dynamic QR with expiry', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/qr/generate', {
      headers: { Authorization: `Bearer ${token}` },
      body: { type: 'dynamic', amount: 10000, expiresInMinutes: 15 },
    });
    expect(res.status).toBe(201);
    expect((res.body as { qr: QrCode }).qr.expiresAt).not.toBeNull();
  });

  it('generates QR without amount', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/qr/generate', {
      headers: { Authorization: `Bearer ${token}` },
      body: { type: 'static' },
    });
    expect(res.status).toBe(201);
    expect((res.body as { qr: QrCode }).qr.amount).toBeNull();
  });

  it('returns 400 for invalid amount', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/qr/generate', {
      headers: { Authorization: `Bearer ${token}` },
      body: { type: 'static', amount: 50 },
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 without token', async () => {
    const res = await client.post('/api/v1/qr/generate', {
      body: { type: 'static' },
    });
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/v1/qr/my ─────────────────────────────────

describe('GET /api/v1/qr/my', () => {
  it('returns user QR codes', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockImplementation((key: string) => {
      if (key.includes('user:user-1')) return Promise.resolve(JSON.stringify(['qr_test001']));
      if (key.includes('qr:qr_test001')) return Promise.resolve(JSON.stringify(sampleQr));
      return Promise.resolve(null);
    });
    const res = await client.get('/api/v1/qr/my', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect((res.body as { count: number }).count).toBe(1);
  });

  it('returns 401 without token', async () => {
    const res = await client.get('/api/v1/qr/my');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/v1/qr/scan/:reference (PUBLIC) ────────────

describe('GET /api/v1/qr/scan/:reference', () => {
  it('resolves active QR (no auth needed)', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.includes('ref:ABC12345')) return Promise.resolve('qr_test001');
      if (key.includes('qr:qr_test001')) return Promise.resolve(JSON.stringify(sampleQr));
      return Promise.resolve(null);
    });
    const res = await client.get('/api/v1/qr/scan/ABC12345');
    expect(res.status).toBe(200);
    const body = res.body as { qr: { reference: string; amount: number } };
    expect(body.qr.reference).toBe('ABC12345');
    expect(body.qr.amount).toBe(5000);
  });

  it('returns 404 for unknown reference', async () => {
    const res = await client.get('/api/v1/qr/scan/UNKNOWN');
    expect(res.status).toBe(404);
  });

  it('returns 410 for expired QR', async () => {
    const expired = { ...sampleQr, status: 'expired' };
    mockRedisGet.mockImplementation((key: string) => {
      if (key.includes('ref:')) return Promise.resolve('qr_test001');
      if (key.includes('qr:qr_test001')) return Promise.resolve(JSON.stringify(expired));
      return Promise.resolve(null);
    });
    const res = await client.get('/api/v1/qr/scan/EXP11111');
    expect(res.status).toBe(410);
  });
});

// ─── DELETE /api/v1/qr/:id ──────────────────────────────

describe('DELETE /api/v1/qr/:id', () => {
  it('cancels own QR', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockResolvedValue(JSON.stringify(sampleQr));
    const res = await client.delete('/api/v1/qr/qr_test001', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect((res.body as { message: string }).message).toContain('cancelado');
  });

  it('returns 404 for non-owner', async () => {
    const token = makeToken('user-2');
    mockRedisGet.mockResolvedValue(JSON.stringify(sampleQr));
    const res = await client.delete('/api/v1/qr/qr_test001', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });
});
