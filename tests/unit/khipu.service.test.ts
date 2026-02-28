/**
 * Unit tests for KhipuService.
 * global.fetch is mocked — no real HTTP calls.
 */

jest.mock('../../src/config/environment', () => ({
  env: {
    NODE_ENV: 'test',
    KHIPU_RECEIVER_ID: 'receiver-123',
    KHIPU_SECRET: 'test-secret-abc',
    ENCRYPTION_KEY_HEX: '0'.repeat(64),
  },
}));

import { KhipuService } from '../../src/services/khipu.service';

// ─── fetch mock helpers ─────────────────────────────────

function mockFetchOk(body: unknown) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }) as jest.Mock;
}

function mockFetchError(status = 500) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve('Internal Server Error'),
  }) as jest.Mock;
}

// ─── Test Suite ──────────────────────────────────────────

describe('KhipuService', () => {
  let svc: KhipuService;

  beforeEach(() => {
    svc = new KhipuService();
    jest.clearAllMocks();
  });

  // ─── createPayment ───────────────────────────────────────

  describe('createPayment', () => {
    const khipuResponse = {
      payment_id: 'khipu-pay-001',
      payment_url: 'https://khipu.com/payment/info/khipu-pay-001',
      simplified_transfer_url: 'https://app.khipu.com/pay/khipu-pay-001',
      app_url: 'khipu://pay/khipu-pay-001',
    };

    it('returns a KhipuPayment with mapped fields on success', async () => {
      mockFetchOk(khipuResponse);

      const result = await svc.createPayment(
        'Recarga WhatPay $10.000',
        10_000,
        'https://whatpay.cl/notify',
        'https://whatpay.cl/success',
        '#WP-2026-AABB1122',
      );

      expect(result.paymentId).toBe('khipu-pay-001');
      expect(result.paymentUrl).toBe(khipuResponse.payment_url);
      expect(result.simplifiedTransferUrl).toBe(khipuResponse.simplified_transfer_url);
      expect(result.appUrl).toBe(khipuResponse.app_url);
    });

    it('POSTs to the correct Khipu endpoint', async () => {
      mockFetchOk(khipuResponse);

      await svc.createPayment('Test', 5_000, 'http://n', 'http://r', 'ref-1');

      const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://khipu.com/api/2.0/payments');
      expect(options.method).toBe('POST');
    });

    it('includes Authorization header with receiver_id:signature format', async () => {
      mockFetchOk(khipuResponse);

      await svc.createPayment('Test', 5_000, 'http://n', 'http://r', 'ref-1');

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      const auth = options.headers.Authorization as string;
      // Should be "receiver-123:<hex_signature>"
      expect(auth).toMatch(/^receiver-123:[0-9a-f]{64}$/);
    });

    it('uses form-encoded body (application/x-www-form-urlencoded)', async () => {
      mockFetchOk(khipuResponse);

      await svc.createPayment('Test subject', 8_500, 'http://n', 'http://r', 'ref-x');

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(options.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      expect(options.body).toContain('currency=CLP');
      expect(options.body).toContain('amount=8500');
    });

    it('throws on Khipu API error', async () => {
      mockFetchError(422);

      await expect(
        svc.createPayment('Test', 5_000, 'http://n', 'http://r', 'ref-1'),
      ).rejects.toThrow('Khipu error: 422');
    });
  });

  // ─── getPaymentStatus ────────────────────────────────────

  describe('getPaymentStatus', () => {
    it('returns status "done" for completed payment', async () => {
      mockFetchOk({
        payment_id: 'pay-001',
        status: 'done',
        amount: 10_000,
        currency: 'CLP',
        payer_name: 'Juan Pérez',
      });

      const result = await svc.getPaymentStatus('pay-001');

      expect(result.paymentId).toBe('pay-001');
      expect(result.status).toBe('done');
      expect(result.amount).toBe(10_000);
      expect(result.payer_name).toBe('Juan Pérez');
    });

    it('returns status "expired" for expired payment', async () => {
      mockFetchOk({ payment_id: 'pay-002', status: 'expired', amount: 0, currency: 'CLP' });
      const result = await svc.getPaymentStatus('pay-002');
      expect(result.status).toBe('expired');
    });

    it('returns status "pending" for any other status string', async () => {
      mockFetchOk({ payment_id: 'pay-003', status: 'processing', amount: 5_000, currency: 'CLP' });
      const result = await svc.getPaymentStatus('pay-003');
      expect(result.status).toBe('pending');
    });

    it('GETs the correct endpoint with paymentId in path', async () => {
      mockFetchOk({ payment_id: 'pay-xyz', status: 'done', amount: 1_000, currency: 'CLP' });

      await svc.getPaymentStatus('pay-xyz');

      const [url] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe('https://khipu.com/api/2.0/payments/pay-xyz');
    });

    it('throws on Khipu status API error', async () => {
      mockFetchError(404);
      await expect(svc.getPaymentStatus('nonexistent')).rejects.toThrow('Khipu status error: 404');
    });
  });

  // ─── verifyNotification ──────────────────────────────────

  describe('verifyNotification', () => {
    it('accepts valid alphanumeric token with api_version 1.3', () => {
      expect(svc.verifyNotification('abc123def', '1.3')).toBe(true);
    });

    it('accepts token with hyphens and underscores', () => {
      expect(svc.verifyNotification('abc-123_def456', '1.3')).toBe(true);
    });

    it('rejects wrong api_version', () => {
      expect(svc.verifyNotification('abc123def', '1.2')).toBe(false);
      expect(svc.verifyNotification('abc123def', '2.0')).toBe(false);
    });

    it('rejects token shorter than 6 characters', () => {
      expect(svc.verifyNotification('abc12', '1.3')).toBe(false);
    });

    it('rejects empty token', () => {
      expect(svc.verifyNotification('', '1.3')).toBe(false);
    });

    it('rejects token with special characters (spaces, @, etc.)', () => {
      expect(svc.verifyNotification('abc 123', '1.3')).toBe(false);
      expect(svc.verifyNotification('abc@123', '1.3')).toBe(false);
      expect(svc.verifyNotification('abc/123', '1.3')).toBe(false);
    });

    it('accepts exactly 6-character token', () => {
      expect(svc.verifyNotification('abcdef', '1.3')).toBe(true);
    });
  });
});
