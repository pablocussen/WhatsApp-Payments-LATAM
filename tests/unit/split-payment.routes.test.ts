/**
 * Split Payment routes unit tests
 * Tests: POST /splits, GET /splits, GET /splits/:id, POST /splits/:id/pay,
 *        POST /splits/:id/decline, DELETE /splits/:id
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisDel = jest.fn().mockResolvedValue(1);
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
    del: (...args: unknown[]) => mockRedisDel(...args),
    incr: (...args: unknown[]) => mockRedisIncr(...args),
    sAdd: jest.fn(),
    sRem: jest.fn(),
    sMembers: jest.fn(),
    sCard: jest.fn(),
    lPush: jest.fn(),
    lRange: jest.fn().mockResolvedValue([]),
    expire: jest.fn().mockResolvedValue(true),
    ping: jest.fn().mockResolvedValue('PONG'),
    multi: jest.fn().mockReturnValue({
      incr: jest.fn().mockReturnThis(),
      incrBy: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
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
import type { SplitPayment } from '../../src/services/split-payment.service';

const JWT_SECRET = 'test-jwt-secret-at-least-32-characters-long';
const makeToken = (userId: string) =>
  jwt.sign(
    { userId, waId: '56912345678', kycLevel: 'BASIC' },
    JWT_SECRET,
    { expiresIn: '30m', issuer: 'whatpay', audience: 'whatpay-api' },
  );

let client: TestClient;

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
});

const sampleSplit: SplitPayment = {
  id: 'spl_test001',
  createdBy: 'user-1',
  creatorName: 'Pablo',
  description: 'Asado',
  totalAmount: 30000,
  splitMethod: 'equal',
  participants: [
    { userId: null, phone: '56911111111', name: 'Juan', amount: 10000, status: 'pending', paidAt: null, transactionRef: null },
    { userId: null, phone: '56922222222', name: 'María', amount: 10000, status: 'pending', paidAt: null, transactionRef: null },
    { userId: null, phone: '56933333333', name: 'Pedro', amount: 10000, status: 'pending', paidAt: null, transactionRef: null },
  ],
  status: 'pending',
  paidCount: 0,
  paidAmount: 0,
  createdAt: new Date().toISOString(),
  completedAt: null,
};

const token = makeToken('user-1');
const authHeader = { Authorization: `Bearer ${token}` };

describe('Split Payment Routes', () => {
  describe('POST /splits', () => {
    it('creates equal split, returns 201 with spl_ id', async () => {
      const res = await client.post('/api/v1/splits', {
        headers: authHeader,
        body: {
          creatorName: 'Pablo',
          description: 'Asado',
          totalAmount: 30000,
          splitMethod: 'equal',
          participants: [
            { phone: '56911111111', name: 'Juan' },
            { phone: '56922222222', name: 'María' },
            { phone: '56933333333', name: 'Pedro' },
          ],
        },
      });

      expect(res.status).toBe(201);
      const body = res.body as { split: SplitPayment };
      expect(body.split).toBeDefined();
      expect(body.split.id).toMatch(/^spl_/);
      expect(body.split.status).toBe('pending');
      expect(body.split.participants).toHaveLength(3);
    });

    it('creates custom split, returns 201', async () => {
      const res = await client.post('/api/v1/splits', {
        headers: authHeader,
        body: {
          creatorName: 'Ana',
          description: 'Cena elegante',
          totalAmount: 50000,
          splitMethod: 'custom',
          participants: [
            { phone: '56911111111', name: 'Juan', amount: 20000 },
            { phone: '56922222222', name: 'María', amount: 30000 },
          ],
        },
      });

      expect(res.status).toBe(201);
      const body = res.body as { split: SplitPayment };
      expect(body.split.splitMethod).toBe('custom');
    });

    it('returns 400 for amount < 200', async () => {
      const res = await client.post('/api/v1/splits', {
        headers: authHeader,
        body: {
          description: 'Café',
          totalAmount: 100,
          splitMethod: 'equal',
          participants: [{ phone: '56911111111', name: 'Juan' }],
        },
      });

      expect(res.status).toBe(400);
    });

    it('returns 400 for empty participants', async () => {
      const res = await client.post('/api/v1/splits', {
        headers: authHeader,
        body: {
          description: 'Empty',
          totalAmount: 10000,
          splitMethod: 'equal',
          participants: [],
        },
      });

      expect(res.status).toBe(400);
    });

    it('returns 401 without token', async () => {
      const res = await client.post('/api/v1/splits', {
        body: {
          description: 'No auth',
          totalAmount: 10000,
          splitMethod: 'equal',
          participants: [{ phone: '56911111111', name: 'Juan' }],
        },
      });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /splits', () => {
    it('returns user splits list', async () => {
      // Mock Redis scan/get to return splits for this user
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'splits:user-1') {
          return Promise.resolve(JSON.stringify(['spl_test001']));
        }
        if (key === 'split:spl_test001') {
          return Promise.resolve(JSON.stringify(sampleSplit));
        }
        return Promise.resolve(null);
      });

      const res = await client.get('/api/v1/splits', { headers: authHeader });

      expect(res.status).toBe(200);
      const body = res.body as { splits: SplitPayment[]; count: number };
      expect(body.splits).toBeDefined();
      expect(typeof body.count).toBe('number');
    });
  });

  describe('GET /splits/:id', () => {
    it('returns split detail with summary text', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'split:spl_test001') {
          return Promise.resolve(JSON.stringify(sampleSplit));
        }
        return Promise.resolve(null);
      });

      const res = await client.get('/api/v1/splits/spl_test001', { headers: authHeader });

      expect(res.status).toBe(200);
      const body = res.body as { split: SplitPayment; summary: string };
      expect(body.split).toBeDefined();
      expect(body.split.id).toBe('spl_test001');
      expect(typeof body.summary).toBe('string');
    });

    it('returns 404 for unknown split', async () => {
      mockRedisGet.mockResolvedValue(null);

      const res = await client.get('/api/v1/splits/spl_nonexistent', { headers: authHeader });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /splits/:id/pay', () => {
    it('records payment', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'split:spl_test001') {
          return Promise.resolve(JSON.stringify(sampleSplit));
        }
        return Promise.resolve(null);
      });

      const res = await client.post('/api/v1/splits/spl_test001/pay', {
        headers: authHeader,
        body: { phone: '56911111111', transactionRef: 'TX_REF_001' },
      });

      expect(res.status).toBe(200);
      const body = res.body as { split: SplitPayment };
      expect(body.split).toBeDefined();
    });

    it('returns 400 without phone', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'split:spl_test001') {
          return Promise.resolve(JSON.stringify(sampleSplit));
        }
        return Promise.resolve(null);
      });

      const res = await client.post('/api/v1/splits/spl_test001/pay', {
        headers: authHeader,
        body: { transactionRef: 'TX_REF_001' },
      });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /splits/:id/decline', () => {
    it('marks participation as declined', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'split:spl_test001') {
          return Promise.resolve(JSON.stringify(sampleSplit));
        }
        return Promise.resolve(null);
      });

      const res = await client.post('/api/v1/splits/spl_test001/decline', {
        headers: authHeader,
        body: { phone: '56911111111' },
      });

      expect(res.status).toBe(200);
      const body = res.body as { message: string };
      expect(body.message).toBeDefined();
    });
  });

  describe('DELETE /splits/:id', () => {
    it('cancels own split', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'split:spl_test001') {
          return Promise.resolve(JSON.stringify(sampleSplit));
        }
        return Promise.resolve(null);
      });

      const res = await client.delete('/api/v1/splits/spl_test001', { headers: authHeader });

      expect(res.status).toBe(200);
      const body = res.body as { message: string };
      expect(body.message).toBeDefined();
    });

    it('returns 404 for non-owner', async () => {
      const otherToken = makeToken('user-999');
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'split:spl_test001') {
          return Promise.resolve(JSON.stringify(sampleSplit));
        }
        return Promise.resolve(null);
      });

      const res = await client.delete('/api/v1/splits/spl_test001', {
        headers: { Authorization: `Bearer ${otherToken}` },
      });

      expect(res.status).toBe(404);
    });
  });
});
