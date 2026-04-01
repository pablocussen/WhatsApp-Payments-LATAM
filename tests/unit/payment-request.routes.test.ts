/**
 * Payment Request routes unit tests
 * Tests: POST /payment-requests, GET /sent, GET /received, GET /:id,
 *        POST /:id/decline, DELETE /:id
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
import type { PaymentRequest } from '../../src/services/payment-request.service';

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

const sampleRequest: PaymentRequest = {
  id: 'preq_test001',
  requesterId: 'user-1',
  requesterName: 'Pablo',
  requesterPhone: '56912345678',
  targetPhone: '56987654321',
  targetName: 'María',
  amount: 15000,
  description: 'Almuerzo',
  status: 'pending',
  transactionRef: null,
  expiresAt: new Date(Date.now() + 72 * 3600000).toISOString(),
  createdAt: new Date().toISOString(),
  respondedAt: null,
};

const token = makeToken('user-1');
const authHeader = { Authorization: `Bearer ${token}` };

describe('Payment Request Routes', () => {
  describe('POST /api/v1/payment-requests', () => {
    it('creates request, returns 201 with preq_ id', async () => {
      const res = await client.post('/api/v1/payment-requests', {
        headers: authHeader,
        body: {
          requesterName: 'Pablo',
          requesterPhone: '56912345678',
          targetPhone: '56987654321',
          amount: 15000,
          description: 'Almuerzo',
        },
      });

      expect(res.status).toBe(201);
      const body = res.body as { request: PaymentRequest };
      expect(body.request).toBeDefined();
      expect(body.request.id).toMatch(/^preq_/);
      expect(body.request.status).toBe('pending');
    });

    it('returns 400 for amount < 100', async () => {
      const res = await client.post('/api/v1/payment-requests', {
        headers: authHeader,
        body: {
          requesterName: 'Pablo',
          requesterPhone: '56912345678',
          targetPhone: '56987654321',
          amount: 50,
          description: 'Café',
        },
      });

      expect(res.status).toBe(400);
    });

    it('returns 409 for self-request (same phone)', async () => {
      const res = await client.post('/api/v1/payment-requests', {
        headers: authHeader,
        body: {
          requesterName: 'Pablo',
          requesterPhone: '56912345678',
          targetPhone: '56912345678',
          amount: 5000,
          description: 'Self',
        },
      });

      expect(res.status).toBe(409);
    });

    it('returns 401 without token', async () => {
      const res = await client.post('/api/v1/payment-requests', {
        body: {
          requesterName: 'Pablo',
          requesterPhone: '56912345678',
          targetPhone: '56987654321',
          amount: 15000,
          description: 'No auth',
        },
      });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/payment-requests/sent', () => {
    it('returns list with count', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'payreq:sent:user-1') {
          return Promise.resolve(JSON.stringify(['preq_test001']));
        }
        if (key === 'payreq:preq_test001') {
          return Promise.resolve(JSON.stringify(sampleRequest));
        }
        return Promise.resolve(null);
      });

      const res = await client.get('/api/v1/payment-requests/sent', { headers: authHeader });

      expect(res.status).toBe(200);
      const body = res.body as { requests: PaymentRequest[]; count: number };
      expect(body.requests).toBeDefined();
      expect(typeof body.count).toBe('number');
    });
  });

  describe('GET /api/v1/payment-requests/received', () => {
    it('returns list by phone', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'payreq:recv:56987654321') {
          return Promise.resolve(JSON.stringify(['preq_test001']));
        }
        if (key === 'payreq:preq_test001') {
          return Promise.resolve(JSON.stringify(sampleRequest));
        }
        return Promise.resolve(null);
      });

      const res = await client.get('/api/v1/payment-requests/received?phone=56987654321', {
        headers: authHeader,
      });

      expect(res.status).toBe(200);
      const body = res.body as { requests: PaymentRequest[]; count: number };
      expect(body.requests).toBeDefined();
      expect(typeof body.count).toBe('number');
    });
  });

  describe('GET /api/v1/payment-requests/:id', () => {
    it('returns detail', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'payreq:preq_test001') {
          return Promise.resolve(JSON.stringify(sampleRequest));
        }
        return Promise.resolve(null);
      });

      const res = await client.get('/api/v1/payment-requests/preq_test001', { headers: authHeader });

      expect(res.status).toBe(200);
      const body = res.body as { request: PaymentRequest };
      expect(body.request).toBeDefined();
      expect(body.request.id).toBe('preq_test001');
    });

    it('returns 404 for unknown', async () => {
      mockRedisGet.mockResolvedValue(null);

      const res = await client.get('/api/v1/payment-requests/preq_nonexistent', { headers: authHeader });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/payment-requests/:id/decline', () => {
    it('declines request', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'payreq:preq_test001') {
          return Promise.resolve(JSON.stringify(sampleRequest));
        }
        return Promise.resolve(null);
      });

      const res = await client.post('/api/v1/payment-requests/preq_test001/decline', {
        headers: authHeader,
      });

      expect(res.status).toBe(200);
      const body = res.body as { request: PaymentRequest };
      expect(body.request).toBeDefined();
      expect(body.request.status).toBe('declined');
    });
  });

  describe('DELETE /api/v1/payment-requests/:id', () => {
    it('cancels own request', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'payreq:preq_test001') {
          return Promise.resolve(JSON.stringify(sampleRequest));
        }
        return Promise.resolve(null);
      });

      const res = await client.delete('/api/v1/payment-requests/preq_test001', { headers: authHeader });

      expect(res.status).toBe(200);
      const body = res.body as { message: string };
      expect(body.message).toBeDefined();
    });
  });
});
