/**
 * Route-level tests for receipt.routes.ts
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
    lTrim: jest.fn(),
    expire: jest.fn().mockResolvedValue(true), ping: jest.fn().mockResolvedValue('PONG'),
    multi: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnThis(), incr: jest.fn().mockReturnThis(),
      lPush: jest.fn().mockReturnThis(), lTrim: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(), incrBy: jest.fn().mockReturnThis(),
      sAdd: jest.fn().mockReturnThis(), del: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([null,null,null,null,null]),
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

const JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
const makeToken = (userId: string) =>
  jwt.sign({ userId, waId: '56912345678', kycLevel: 'BASIC' }, JWT_SECRET,
    { expiresIn: '30m', issuer: 'whatpay', audience: 'whatpay-api' });

let client: TestClient;

const sampleReceipt = {
  id: 'rcp_test001',
  type: 'payment',
  reference: '#WP-2026-XYZ',
  senderName: 'Pablo',
  senderPhone: '56912345678',
  receiverName: 'Maria',
  receiverPhone: '56987654321',
  amount: 10000,
  fee: 0,
  netAmount: 10000,
  description: 'Pago',
  paymentMethod: 'WALLET',
  status: 'COMPLETED',
  createdAt: new Date().toISOString(),
  formattedText: 'Recibo...',
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

describe('GET /api/v1/receipts', () => {
  it('returns user receipts list', async () => {
    const token = makeToken('user-1');
    // First call: getUserReceipts reads the user receipts index (ids list)
    // Second call: getReceipt reads the actual receipt by id
    mockRedisGet
      .mockResolvedValueOnce(JSON.stringify(['rcp_test001']))  // user receipts index
      .mockResolvedValueOnce(JSON.stringify(sampleReceipt));   // receipt by id
    const res = await client.get('/api/v1/receipts', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { receipts: unknown[]; count: number };
    expect(body.receipts).toHaveLength(1);
    expect(body.count).toBe(1);
  });

  it('returns empty for new user', async () => {
    const token = makeToken('user-1');
    const res = await client.get('/api/v1/receipts', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { receipts: unknown[]; count: number };
    expect(body.receipts).toHaveLength(0);
    expect(body.count).toBe(0);
  });
});

describe('GET /api/v1/receipts/:id', () => {
  it('returns receipt detail', async () => {
    const token = makeToken('user-1');
    mockRedisGet.mockResolvedValue(JSON.stringify(sampleReceipt));
    const res = await client.get('/api/v1/receipts/rcp_test001', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { receipt: { id: string; reference: string } };
    expect(body.receipt.id).toBe('rcp_test001');
    expect(body.receipt.reference).toBe('#WP-2026-XYZ');
  });

  it('returns 404 when not found', async () => {
    const token = makeToken('user-1');
    const res = await client.get('/api/v1/receipts/rcp_unknown', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/v1/receipts/search', () => {
  it('finds receipt by reference', async () => {
    const token = makeToken('user-1');
    // findByReference calls getUserReceipts(phone) then filters by reference
    mockRedisGet
      .mockResolvedValueOnce(JSON.stringify(['rcp_test001']))  // user receipts index
      .mockResolvedValueOnce(JSON.stringify(sampleReceipt));   // receipt by id
    const res = await client.get('/api/v1/receipts/search?ref=%23WP-2026-XYZ', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = res.body as { receipt: { id: string; reference: string } | null };
    expect(body.receipt).toBeDefined();
  });
});

describe('Auth', () => {
  it('returns 401 without token', async () => {
    const res = await client.get('/api/v1/receipts');
    expect(res.status).toBe(401);
  });
});
