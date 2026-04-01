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
    del: jest.fn(), incr: (...args: unknown[]) => mockRedisIncr(...args),
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
import type { ScheduledTransfer } from '../../src/services/scheduled-transfer.service';

const JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
const makeToken = (userId: string) => jwt.sign({ userId, waId: '56912345678', kycLevel: 'BASIC' }, JWT_SECRET, { expiresIn: '30m', issuer: 'whatpay', audience: 'whatpay-api' });

let client: TestClient;

beforeAll(async () => {
  const { default: app } = await import('../../src/api/server');
  client = await startTestServer(app);
});
afterAll(async () => { await client.close(); });
beforeEach(() => { jest.clearAllMocks(); mockRedisGet.mockResolvedValue(null); });

const sampleTransfer: ScheduledTransfer = {
  id: 'stx_test001', senderId: 'test-user-id', receiverPhone: '56987654321',
  receiverName: 'María', amount: 15000, description: 'Mesada',
  frequency: 'monthly', scheduledDate: '2026-04-01', scheduledTime: '09:00',
  status: 'scheduled', lastExecutedAt: null, executionCount: 0,
  nextExecutionDate: '2026-04-01', transactionRef: null,
  createdAt: new Date().toISOString(),
};

const token = makeToken('test-user-id');
const authHeader = { Authorization: `Bearer ${token}` };

describe('Scheduled Transfer Routes', () => {
  describe('POST /api/v1/scheduled-transfers', () => {
    it('creates transfer, returns 201 with stx_ id', async () => {
      const res = await client.post('/api/v1/scheduled-transfers', {
        headers: authHeader,
        body: {
          receiverPhone: '56987654321', receiverName: 'María',
          amount: 15000, description: 'Mesada',
          frequency: 'monthly', scheduledDate: '2026-04-01',
        },
      });

      expect(res.status).toBe(201);
      const data = res.body as { transfer: ScheduledTransfer };
      expect(data.transfer.id).toMatch(/^stx_/);
      expect(data.transfer.amount).toBe(15000);
      expect(data.transfer.status).toBe('scheduled');
    });

    it('returns 400 for amount < 100', async () => {
      const res = await client.post('/api/v1/scheduled-transfers', {
        headers: authHeader,
        body: {
          receiverPhone: '56987654321', receiverName: 'María',
          amount: 50, description: 'Poco',
          frequency: 'once', scheduledDate: '2026-05-01',
        },
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for invalid date', async () => {
      const res = await client.post('/api/v1/scheduled-transfers', {
        headers: authHeader,
        body: {
          receiverPhone: '56987654321', receiverName: 'María',
          amount: 5000, description: 'Test',
          frequency: 'once', scheduledDate: '01-04-2026',
        },
      });

      expect(res.status).toBe(400);
    });

    it('returns 401 without token', async () => {
      const res = await client.post('/api/v1/scheduled-transfers', {
        body: {
          receiverPhone: '56987654321', receiverName: 'María',
          amount: 5000, description: 'Test',
          frequency: 'once', scheduledDate: '2026-05-01',
        },
      });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/scheduled-transfers', () => {
    it('returns user transfers list', async () => {
      // Mock: user has one transfer in their list
      mockRedisGet
        .mockResolvedValueOnce(JSON.stringify(['stx_test001']))   // user list
        .mockResolvedValueOnce(JSON.stringify(sampleTransfer));    // transfer detail

      const res = await client.get('/api/v1/scheduled-transfers', { headers: authHeader });

      expect(res.status).toBe(200);
      const data = res.body as { transfers: ScheduledTransfer[]; count: number };
      expect(data.transfers).toBeInstanceOf(Array);
      expect(typeof data.count).toBe('number');
    });
  });

  describe('GET /api/v1/scheduled-transfers/:id', () => {
    it('returns transfer detail', async () => {
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(sampleTransfer));

      const res = await client.get('/api/v1/scheduled-transfers/stx_test001', { headers: authHeader });

      expect(res.status).toBe(200);
      const data = res.body as { transfer: ScheduledTransfer };
      expect(data.transfer.id).toBe('stx_test001');
      expect(data.transfer.amount).toBe(15000);
    });

    it('returns 404 for unknown transfer', async () => {
      mockRedisGet.mockResolvedValueOnce(null);

      const res = await client.get('/api/v1/scheduled-transfers/stx_nonexistent', { headers: authHeader });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/v1/scheduled-transfers/:id', () => {
    it('cancels own transfer', async () => {
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(sampleTransfer));

      const res = await client.delete('/api/v1/scheduled-transfers/stx_test001', { headers: authHeader });

      expect(res.status).toBe(200);
      const data = res.body as { message: string };
      expect(data.message).toBe('Transferencia cancelada.');
    });
  });
});
