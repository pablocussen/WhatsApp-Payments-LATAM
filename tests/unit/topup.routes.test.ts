/**
 * Route-level tests for topup.routes.ts.
 * Covers: POST /webpay, POST /webpay/callback, POST /khipu, POST /khipu/notify.
 * Uses http-test-client (Node built-ins) — no external packages required.
 */

// ─── Mock variables ────────────────────────────────────────────────────────────

const mockTransbankCreate = jest.fn();
const mockTransbankConfirm = jest.fn();
const mockKhipuCreate = jest.fn();
const mockKhipuVerify = jest.fn();
const mockKhipuStatus = jest.fn();
const mockTopupCredit = jest.fn();
const mockWhatsAppSend = jest.fn();
const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn();
const mockRedisDel = jest.fn();

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
  getRedis: jest.fn().mockReturnValue({
    set: mockRedisSet,
    get: mockRedisGet,
    del: mockRedisDel,
  }),
  prisma: {},
}));

jest.mock('../../src/services/transbank.service', () => ({
  TransbankService: jest.fn().mockImplementation(() => ({
    createTransaction: mockTransbankCreate,
    confirmTransaction: mockTransbankConfirm,
  })),
}));

jest.mock('../../src/services/khipu.service', () => ({
  KhipuService: jest.fn().mockImplementation(() => ({
    createPayment: mockKhipuCreate,
    verifyNotification: mockKhipuVerify,
    getPaymentStatus: mockKhipuStatus,
  })),
}));

jest.mock('../../src/services/wallet.service', () => ({
  WalletService: jest.fn().mockImplementation(() => ({
    topup: mockTopupCredit,
  })),
}));

jest.mock('../../src/services/whatsapp.service', () => ({
  WhatsAppService: jest.fn().mockImplementation(() => ({
    sendTextMessage: mockWhatsAppSend,
  })),
}));

jest.mock('../../src/utils/crypto', () => ({
  generateReference: jest.fn().mockReturnValue('#WP-2026-TESTREF'),
}));

import express from 'express';
import router from '../../src/api/topup.routes';
import { generateToken } from '../../src/middleware/jwt.middleware';
import { startTestServer, type TestClient } from './http-test-client';

const app = express().use(express.json()).use(router);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const authToken = (userId = 'user-uuid-001', waId = '56912345678') =>
  generateToken({ userId, waId, kycLevel: 'BASIC' });

const withAuth = () => ({
  headers: { Authorization: `Bearer ${authToken()}` },
});

// ─── Server lifecycle ─────────────────────────────────────────────────────────

let client: TestClient;
beforeAll(async () => {
  client = await startTestServer(app);
});
afterAll(async () => {
  await client.close();
});

// ─── POST /webpay ─────────────────────────────────────────────────────────────

describe('POST /webpay', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    const res = await client.post('/webpay', { body: { amount: 10000 } });
    expect(res.status).toBe(401);
  });

  it('returns 400 when amount is below minimum (1000)', async () => {
    const res = await client.post('/webpay', { ...withAuth(), body: { amount: 500 } });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toMatch(/1\.000/);
  });

  it('returns 400 when amount exceeds maximum (500000)', async () => {
    const res = await client.post('/webpay', { ...withAuth(), body: { amount: 600_000 } });
    expect(res.status).toBe(400);
  });

  it('returns 200 with redirect URL on success', async () => {
    mockTransbankCreate.mockResolvedValue({
      url: 'https://webpay3g.transbank.cl/initTransaction',
      token: 'tbk-token-abc',
    });
    mockRedisSet.mockResolvedValue('OK');
    const res = await client.post('/webpay', { ...withAuth(), body: { amount: 10000 } });
    expect(res.status).toBe(200);
    const body = res.body as { redirectUrl: string; token: string; amount: number };
    expect(body.redirectUrl).toBeDefined();
    expect(body.token).toBe('tbk-token-abc');
    expect(body.amount).toBe(10000);
    expect(mockRedisSet).toHaveBeenCalledWith(
      expect.stringContaining('topup:webpay:'),
      expect.stringContaining('user-uuid-001'),
      expect.objectContaining({ EX: 3600 }),
    );
  });
});

// ─── POST /webpay/callback ────────────────────────────────────────────────────

describe('POST /webpay/callback', () => {
  beforeEach(() => jest.clearAllMocks());

  it('responds 302 redirecting to error when token_ws is missing', async () => {
    const res = await client.post('/webpay/callback', { body: {} });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('no_token');
  });

  it('responds 302 to error when Transbank status is not AUTHORIZED', async () => {
    mockTransbankConfirm.mockResolvedValue({ status: 'FAILED', buyOrder: 'WP-2026-TESTREF' });
    const res = await client.post('/webpay/callback', { body: { token_ws: 'bad-token' } });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('FAILED');
  });

  it('responds 302 to error when buy_order is missing from Transbank response', async () => {
    mockTransbankConfirm.mockResolvedValue({ status: 'AUTHORIZED', buyOrder: null });
    const res = await client.post('/webpay/callback', { body: { token_ws: 'ok-token' } });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('missing_buy_order');
  });

  it('responds 302 to error when Redis mapping not found', async () => {
    mockTransbankConfirm.mockResolvedValue({
      status: 'AUTHORIZED',
      buyOrder: 'WP-2026-TESTREF',
    });
    mockRedisGet.mockResolvedValue(null);
    const res = await client.post('/webpay/callback', { body: { token_ws: 'ok-token' } });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('mapping_not_found');
  });

  it('credits wallet and redirects to success on valid callback', async () => {
    mockTransbankConfirm.mockResolvedValue({
      status: 'AUTHORIZED',
      buyOrder: 'WP-2026-TESTREF',
      amount: 10000,
      cardLast4: '1234',
    });
    mockRedisGet.mockResolvedValue(
      JSON.stringify({ userId: 'u1', waId: '56912345678', amount: 10000, ref: '#WP-2026-TESTREF' }),
    );
    mockTopupCredit.mockResolvedValue({ id: 'tx-001' });
    mockRedisDel.mockResolvedValue(1);
    mockWhatsAppSend.mockResolvedValue(undefined);

    const res = await client.post('/webpay/callback', { body: { token_ws: 'good-token' } });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('success');
    expect(mockTopupCredit).toHaveBeenCalledWith(
      'u1',
      10000,
      'WEBPAY_CREDIT',
      '#WP-2026-TESTREF',
      expect.any(String),
    );
    expect(mockRedisDel).toHaveBeenCalled();
  });

  it('still redirects to success even if WhatsApp notification fails', async () => {
    mockTransbankConfirm.mockResolvedValue({
      status: 'AUTHORIZED',
      buyOrder: 'WP-2026-TESTREF',
      amount: 10000,
    });
    mockRedisGet.mockResolvedValue(
      JSON.stringify({ userId: 'u1', waId: '56912345678', amount: 10000, ref: '#WP-2026-TESTREF' }),
    );
    mockTopupCredit.mockResolvedValue({ id: 'tx-001' });
    mockRedisDel.mockResolvedValue(1);
    mockWhatsAppSend.mockRejectedValue(new Error('WhatsApp API down'));

    const res = await client.post('/webpay/callback', { body: { token_ws: 'good-token' } });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('success');
  });

  it('redirects to error when an unexpected exception is thrown', async () => {
    mockTransbankConfirm.mockRejectedValue(new Error('Transbank timeout'));
    const res = await client.post('/webpay/callback', { body: { token_ws: 'crash-token' } });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('processing_error');
  });
});

// ─── POST /khipu ──────────────────────────────────────────────────────────────

describe('POST /khipu', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when not authenticated', async () => {
    const res = await client.post('/khipu', { body: { amount: 10000 } });
    expect(res.status).toBe(401);
  });

  it('returns 400 when amount is below minimum', async () => {
    const res = await client.post('/khipu', { ...withAuth(), body: { amount: 500 } });
    expect(res.status).toBe(400);
  });

  it('returns 200 with paymentUrl on success', async () => {
    mockKhipuCreate.mockResolvedValue({
      paymentId: 'khipu-001',
      paymentUrl: 'https://khipu.com/payment/info/khipu-001',
    });
    mockRedisSet.mockResolvedValue('OK');

    const res = await client.post('/khipu', { ...withAuth(), body: { amount: 10000 } });
    expect(res.status).toBe(200);
    const body = res.body as { paymentUrl: string; paymentId: string };
    expect(body.paymentUrl).toContain('khipu');
    expect(body.paymentId).toBe('khipu-001');
    expect(mockRedisSet).toHaveBeenCalledWith(
      'topup:khipu:khipu-001',
      expect.any(String),
      expect.objectContaining({ EX: 3600 }),
    );
  });
});

// ─── POST /khipu/notify ───────────────────────────────────────────────────────

describe('POST /khipu/notify', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 400 when notification fails verification', async () => {
    mockKhipuVerify.mockReturnValue(false);
    const res = await client.post('/khipu/notify', {
      body: { notification_token: 'bad', api_version: '1.3' },
    });
    expect(res.status).toBe(400);
  });

  it('responds 200 immediately on valid notification', async () => {
    mockKhipuVerify.mockReturnValue(true);
    mockKhipuStatus.mockResolvedValue({ status: 'done', paymentId: 'khipu-001' });
    mockRedisGet.mockResolvedValue(
      JSON.stringify({ userId: 'u1', waId: '56912345678', amount: 10000 }),
    );
    mockTopupCredit.mockResolvedValue({ id: 'tx-k1' });
    mockRedisDel.mockResolvedValue(1);
    mockWhatsAppSend.mockResolvedValue(undefined);

    const res = await client.post('/khipu/notify', {
      body: { notification_token: 'valid-token', api_version: '1.3' },
    });
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe('received');
  });

  it('credits wallet when Khipu status is done and mapping exists', async () => {
    mockKhipuVerify.mockReturnValue(true);
    mockKhipuStatus.mockResolvedValue({ status: 'done', paymentId: 'khipu-001' });
    mockRedisGet.mockResolvedValue(
      JSON.stringify({ userId: 'u1', waId: '56912345678', amount: 15000 }),
    );
    mockTopupCredit.mockResolvedValue({ id: 'tx-k2' });
    mockRedisDel.mockResolvedValue(1);
    mockWhatsAppSend.mockResolvedValue(undefined);

    await client.post('/khipu/notify', {
      body: { notification_token: 'valid-token', api_version: '1.3' },
    });
    // Allow async post-response processing to settle
    await new Promise((r) => setTimeout(r, 100));
    expect(mockTopupCredit).toHaveBeenCalledWith(
      'u1',
      15000,
      'KHIPU',
      'KHIPU:khipu-001',
      expect.any(String),
    );
  });

  it('does not credit wallet when Khipu status is not done', async () => {
    mockKhipuVerify.mockReturnValue(true);
    mockKhipuStatus.mockResolvedValue({ status: 'pending', paymentId: 'khipu-002' });

    await client.post('/khipu/notify', {
      body: { notification_token: 'valid-token', api_version: '1.3' },
    });
    await new Promise((r) => setTimeout(r, 100));
    expect(mockTopupCredit).not.toHaveBeenCalled();
  });

  it('handles missing Redis mapping gracefully (no credit, no crash)', async () => {
    mockKhipuVerify.mockReturnValue(true);
    mockKhipuStatus.mockResolvedValue({ status: 'done', paymentId: 'khipu-003' });
    mockRedisGet.mockResolvedValue(null);

    const res = await client.post('/khipu/notify', {
      body: { notification_token: 'valid-token', api_version: '1.3' },
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    expect(mockTopupCredit).not.toHaveBeenCalled();
  });

  it('handles Khipu processing error without crashing (notify still responded 200)', async () => {
    mockKhipuVerify.mockReturnValue(true);
    mockKhipuStatus.mockRejectedValue(new Error('Khipu API timeout'));

    const res = await client.post('/khipu/notify', {
      body: { notification_token: 'valid-token', api_version: '1.3' },
    });
    // 200 was already sent before the processing error
    expect(res.status).toBe(200);
  });

  it('handles WhatsApp notification failure gracefully after crediting wallet', async () => {
    mockKhipuVerify.mockReturnValue(true);
    mockKhipuStatus.mockResolvedValue({ status: 'done', paymentId: 'khipu-004' });
    mockRedisGet.mockResolvedValue(
      JSON.stringify({ userId: 'u1', waId: '56912345678', amount: 20000 }),
    );
    mockTopupCredit.mockResolvedValue({ id: 'tx-k4' });
    mockRedisDel.mockResolvedValue(1);
    mockWhatsAppSend.mockRejectedValue(new Error('WhatsApp rate limit'));

    await client.post('/khipu/notify', {
      body: { notification_token: 'valid-token', api_version: '1.3' },
    });
    await new Promise((r) => setTimeout(r, 100));
    // Wallet was still credited despite WhatsApp failure
    expect(mockTopupCredit).toHaveBeenCalledWith(
      'u1',
      20000,
      'KHIPU',
      'KHIPU:khipu-004',
      expect.any(String),
    );
  });
});
