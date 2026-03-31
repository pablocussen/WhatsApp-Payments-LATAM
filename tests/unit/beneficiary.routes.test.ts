/**
 * Route-level tests for beneficiary.routes.ts
 * Covers: GET /beneficiaries, POST /beneficiaries, POST /beneficiaries/:id/update,
 *         DELETE /beneficiaries/:id, GET /beneficiaries/search
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
    del: jest.fn(), sAdd: jest.fn(), sRem: jest.fn(), sMembers: jest.fn(), sCard: jest.fn(),
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
import type { Beneficiary } from '../../src/services/beneficiary.service';

const JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
const makeToken = (userId: string) =>
  jwt.sign({ userId, waId: '56912345678', kycLevel: 'BASIC' }, JWT_SECRET,
    { expiresIn: '30m', issuer: 'whatpay', audience: 'whatpay-api' });

let client: TestClient;

const sampleBene: Beneficiary = {
  id: 'ben_test001',
  userId: 'user-1',
  name: 'María López',
  phone: '56987654321',
  alias: 'Mamá',
  defaultAmount: 10000,
  lastUsedAt: null,
  createdAt: new Date().toISOString(),
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
  mockRedisIncr.mockResolvedValue(1);
});

// ─── GET /api/v1/beneficiaries ──────────────────────────

describe('GET /api/v1/beneficiaries', () => {
  it('returns empty for new user', async () => {
    const token = makeToken('user-1');
    const res = await client.get('/api/v1/beneficiaries', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { beneficiaries: Beneficiary[]; count: number };
    expect(body.count).toBe(0);
    expect(body.beneficiaries).toEqual([]);
  });

  it('returns saved beneficiaries', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockResolvedValue(JSON.stringify([sampleBene]));
    const res = await client.get('/api/v1/beneficiaries', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { beneficiaries: Beneficiary[]; count: number };
    expect(body.count).toBe(1);
    expect(body.beneficiaries[0].name).toBe('María López');
  });

  it('returns 401 without token', async () => {
    const res = await client.get('/api/v1/beneficiaries');
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/v1/beneficiaries ─────────────────────────

describe('POST /api/v1/beneficiaries', () => {
  it('adds a new beneficiary', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/beneficiaries', {
      headers: { Authorization: `Bearer ${token}` },
      body: { name: 'Juan Pérez', phone: '56911111111', alias: 'Socio', defaultAmount: 5000 },
    });
    expect(res.status).toBe(201);
    const body = res.body as { beneficiary: Beneficiary };
    expect(body.beneficiary.id).toMatch(/^ben_/);
    expect(body.beneficiary.name).toBe('Juan Pérez');
    expect(body.beneficiary.alias).toBe('Socio');
  });

  it('returns 409 for duplicate phone', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockResolvedValue(JSON.stringify([sampleBene]));
    const res = await client.post('/api/v1/beneficiaries', {
      headers: { Authorization: `Bearer ${token}` },
      body: { name: 'Otra María', phone: '56987654321' },
    });
    expect(res.status).toBe(409);
  });

  it('returns 400 for invalid phone', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/beneficiaries', {
      headers: { Authorization: `Bearer ${token}` },
      body: { name: 'Test', phone: '123' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 for missing name', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/beneficiaries', {
      headers: { Authorization: `Bearer ${token}` },
      body: { phone: '56911111111' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 401 without token', async () => {
    const res = await client.post('/api/v1/beneficiaries', {
      body: { name: 'Test', phone: '56911111111' },
    });
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/v1/beneficiaries/:id/update ──────────────

describe('POST /api/v1/beneficiaries/:id/update', () => {
  it('updates alias', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockResolvedValue(JSON.stringify([sampleBene]));
    const res = await client.post('/api/v1/beneficiaries/ben_test001/update', {
      headers: { Authorization: `Bearer ${token}` },
      body: { alias: 'Mami' },
    });
    expect(res.status).toBe(200);
    expect((res.body as { beneficiary: Beneficiary }).beneficiary.alias).toBe('Mami');
  });

  it('returns 404 for unknown beneficiary', async () => {
    const token = makeToken('user-1');
    const res = await client.post('/api/v1/beneficiaries/ben_unknown/update', {
      headers: { Authorization: `Bearer ${token}` },
      body: { alias: 'Test' },
    });
    expect(res.status).toBe(404);
  });
});

// ─── DELETE /api/v1/beneficiaries/:id ───────────────────

describe('DELETE /api/v1/beneficiaries/:id', () => {
  it('removes a beneficiary', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockResolvedValue(JSON.stringify([sampleBene]));
    const res = await client.delete('/api/v1/beneficiaries/ben_test001', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect((res.body as { message: string }).message).toContain('eliminado');
  });

  it('returns 404 for unknown beneficiary', async () => {
    const token = makeToken('user-1');
    const res = await client.delete('/api/v1/beneficiaries/ben_unknown', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });

  it('returns 401 without token', async () => {
    const res = await client.delete('/api/v1/beneficiaries/ben_test001');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/v1/beneficiaries/search ───────────────────

describe('GET /api/v1/beneficiaries/search', () => {
  it('finds by phone', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockResolvedValue(JSON.stringify([sampleBene]));
    const res = await client.get('/api/v1/beneficiaries/search?phone=56987654321', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect((res.body as { beneficiary: Beneficiary }).beneficiary.name).toBe('María López');
  });

  it('returns null for no match', async () => {
    const token = makeToken('user-1');
    const res = await client.get('/api/v1/beneficiaries/search?phone=56999999999', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    expect((res.body as { beneficiary: null }).beneficiary).toBeNull();
  });

  it('returns 400 without phone param', async () => {
    const token = makeToken('user-1');
    const res = await client.get('/api/v1/beneficiaries/search', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(400);
  });
});
