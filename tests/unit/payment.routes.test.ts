/**
 * Route-level tests for payment.routes.ts.
 * Covers: GET /links/:code, POST /links, GET /links, DELETE /links/:id,
 *         POST /pay, GET /history, GET /wallet/balance.
 * Uses http-test-client (Node built-ins) — no external packages required.
 */

// ─── Mock variables ────────────────────────────────────────────────────────────

const mockResolveLink = jest.fn();
const mockCreateLink = jest.fn();
const mockGetMerchantLinks = jest.fn();
const mockDeactivateLink = jest.fn();
const mockProcessP2PPayment = jest.fn();
const mockGetTransactionHistory = jest.fn();
const mockPaymentGetBalance = jest.fn();

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('../../src/config/environment', () => ({
  env: {
    NODE_ENV: 'test',
    JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
    JWT_EXPIRATION: '30m',
    APP_BASE_URL: 'http://localhost:3000',
  },
}));

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({ ping: jest.fn() }),
  prisma: {},
}));

jest.mock('../../src/services/payment-link.service', () => ({
  PaymentLinkService: jest.fn().mockImplementation(() => ({
    resolveLink: mockResolveLink,
    createLink: mockCreateLink,
    getMerchantLinks: mockGetMerchantLinks,
    deactivateLink: mockDeactivateLink,
  })),
}));

jest.mock('../../src/services/transaction.service', () => ({
  TransactionService: jest.fn().mockImplementation(() => ({
    processP2PPayment: mockProcessP2PPayment,
    getTransactionHistory: mockGetTransactionHistory,
  })),
}));

jest.mock('../../src/services/wallet.service', () => ({
  WalletService: jest.fn().mockImplementation(() => ({
    getBalance: mockPaymentGetBalance,
  })),
}));

import express from 'express';
import router from '../../src/api/payment.routes';
import { generateToken } from '../../src/middleware/jwt.middleware';
import { startTestServer, type TestClient } from './http-test-client';

const app = express().use(express.json()).use(router);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const authToken = () =>
  generateToken({ userId: 'user-uuid-001', waId: '56912345678', kycLevel: 'FULL' });

const withAuth = (headers?: Record<string, string>) => ({
  headers: { Authorization: `Bearer ${authToken()}`, ...headers },
});

// ─── Server lifecycle ─────────────────────────────────────────────────────────

let client: TestClient;
beforeAll(async () => {
  client = await startTestServer(app);
});
afterAll(async () => {
  await client.close();
});

// ─── GET /links/:code (public) ────────────────────────────────────────────────

describe('GET /links/:code', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 404 when link not found', async () => {
    mockResolveLink.mockResolvedValue(null);
    const res = await client.get('/links/NOTFOUND');
    expect(res.status).toBe(404);
    expect((res.body as { error: string }).error).toMatch(/inválido/i);
  });

  it('returns 200 with link data when found', async () => {
    const link = { code: 'ABC123', amount: 5000, description: 'Test' };
    mockResolveLink.mockResolvedValue(link);
    const res = await client.get('/links/ABC123');
    expect(res.status).toBe(200);
    expect((res.body as { code: string }).code).toBe('ABC123');
  });
});

// ─── POST /links ──────────────────────────────────────────────────────────────

describe('POST /links', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    const res = await client.post('/links', { body: { amount: 5000 } });
    expect(res.status).toBe(401);
  });

  it('returns 400 when amount is below minimum (100)', async () => {
    const res = await client.post('/links', { ...withAuth(), body: { amount: 50 } });
    expect(res.status).toBe(400);
  });

  it('returns 400 when amount exceeds maximum (50_000_000)', async () => {
    const res = await client.post('/links', { ...withAuth(), body: { amount: 99_000_000 } });
    expect(res.status).toBe(400);
  });

  it('returns 201 with created link', async () => {
    const link = { id: 'link-001', code: 'XYZ', amount: 5000 };
    mockCreateLink.mockResolvedValue(link);
    const res = await client.post('/links', { ...withAuth(), body: { amount: 5000 } });
    expect(res.status).toBe(201);
    expect((res.body as { code: string }).code).toBe('XYZ');
  });

  it('returns 201 with no body (optional amount)', async () => {
    const link = { id: 'link-002', code: 'OPEN' };
    mockCreateLink.mockResolvedValue(link);
    const res = await client.post('/links', { ...withAuth(), body: {} });
    expect(res.status).toBe(201);
  });
});

// ─── GET /links ───────────────────────────────────────────────────────────────

describe('GET /links', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    const res = await client.get('/links');
    expect(res.status).toBe(401);
  });

  it('returns 200 with links array', async () => {
    mockGetMerchantLinks.mockResolvedValue([{ id: 'l1' }, { id: 'l2' }]);
    const res = await client.get('/links', withAuth());
    expect(res.status).toBe(200);
    expect((res.body as { links: unknown[] }).links).toHaveLength(2);
  });
});

// ─── DELETE /links/:id ────────────────────────────────────────────────────────

describe('DELETE /links/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    const res = await client.delete('/links/link-001');
    expect(res.status).toBe(401);
  });

  it('returns 404 when link not found or not owned', async () => {
    mockDeactivateLink.mockResolvedValue(false);
    const res = await client.delete('/links/link-999', withAuth());
    expect(res.status).toBe(404);
  });

  it('returns 200 on successful deactivation', async () => {
    mockDeactivateLink.mockResolvedValue(true);
    const res = await client.delete('/links/link-001', withAuth());
    expect(res.status).toBe(200);
    expect((res.body as { message: string }).message).toMatch(/desactivado/i);
  });
});

// ─── POST /pay ────────────────────────────────────────────────────────────────

describe('POST /pay', () => {
  const validPayload = {
    receiverId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    amount: 10000,
    paymentMethod: 'WALLET',
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    const res = await client.post('/pay', { body: validPayload });
    expect(res.status).toBe(401);
  });

  it('returns 400 when body is invalid (missing receiverId)', async () => {
    const res = await client.post('/pay', {
      ...withAuth(),
      body: { amount: 1000, paymentMethod: 'WALLET' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when amount is below minimum (100)', async () => {
    const res = await client.post('/pay', {
      ...withAuth(),
      body: { ...validPayload, amount: 50 },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when paymentMethod is invalid', async () => {
    const res = await client.post('/pay', {
      ...withAuth(),
      body: { ...validPayload, paymentMethod: 'CASH' },
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when payment fails (business error)', async () => {
    mockProcessP2PPayment.mockResolvedValue({ success: false, error: 'Saldo insuficiente.' });
    const res = await client.post('/pay', { ...withAuth(), body: validPayload });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('Saldo insuficiente.');
  });

  it('returns 403 when payment is fraud-blocked', async () => {
    mockProcessP2PPayment.mockResolvedValue({
      success: false,
      fraudBlocked: true,
      error: 'Transacción bloqueada.',
    });
    const res = await client.post('/pay', { ...withAuth(), body: validPayload });
    expect(res.status).toBe(403);
  });

  it('returns 201 on successful payment', async () => {
    mockProcessP2PPayment.mockResolvedValue({
      success: true,
      transactionId: 'tx-001',
      amount: 10000,
      fee: 0,
    });
    const res = await client.post('/pay', { ...withAuth(), body: validPayload });
    expect(res.status).toBe(201);
    expect((res.body as { transactionId: string }).transactionId).toBe('tx-001');
  });
});

// ─── GET /history ─────────────────────────────────────────────────────────────

describe('GET /history', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    const res = await client.get('/history');
    expect(res.status).toBe(401);
  });

  it('returns 200 with history array (default limit 20)', async () => {
    mockGetTransactionHistory.mockResolvedValue([{ id: 'tx-1' }]);
    const res = await client.get('/history', withAuth());
    expect(res.status).toBe(200);
    expect((res.body as { history: unknown[] }).history).toHaveLength(1);
  });

  it('accepts custom limit query parameter', async () => {
    mockGetTransactionHistory.mockResolvedValue([]);
    const res = await client.get('/history?limit=5', withAuth());
    expect(res.status).toBe(200);
    expect(mockGetTransactionHistory).toHaveBeenCalledWith(expect.any(String), 5);
  });

  it('uses default limit 20 for invalid limit parameter', async () => {
    mockGetTransactionHistory.mockResolvedValue([]);
    const res = await client.get('/history?limit=not-a-number', withAuth());
    expect(res.status).toBe(200);
    expect(mockGetTransactionHistory).toHaveBeenCalledWith(expect.any(String), 20);
  });
});

// ─── GET /wallet/balance ──────────────────────────────────────────────────────

describe('GET /wallet/balance', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    const res = await client.get('/wallet/balance');
    expect(res.status).toBe(401);
  });

  it('returns 200 with balance data', async () => {
    mockPaymentGetBalance.mockResolvedValue({ balance: 75000, currency: 'CLP' });
    const res = await client.get('/wallet/balance', withAuth());
    expect(res.status).toBe(200);
    expect((res.body as { balance: number }).balance).toBe(75000);
  });
});
