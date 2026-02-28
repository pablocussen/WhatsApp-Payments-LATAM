/**
 * Unit tests for TransbankService.
 * global.fetch is mocked — no real HTTP calls.
 */

jest.mock('../../src/config/environment', () => ({
  env: {
    NODE_ENV: 'test',
    TRANSBANK_COMMERCE_CODE: '597055555532',
    TRANSBANK_API_KEY: 'test-api-key',
    TRANSBANK_ENVIRONMENT: 'integration',
    ENCRYPTION_KEY_HEX: '0'.repeat(64),
  },
}));

import { TransbankService } from '../../src/services/transbank.service';

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
    text: () => Promise.resolve('Error'),
  }) as jest.Mock;
}

const BASE_URL = 'https://webpay3gint.transbank.cl'; // integration

// ─── Test Suite ──────────────────────────────────────────

describe('TransbankService', () => {
  let svc: TransbankService;

  beforeEach(() => {
    svc = new TransbankService();
    jest.clearAllMocks();
  });

  // ─── constructor ─────────────────────────────────────────

  describe('constructor', () => {
    it('uses integration URL when TRANSBANK_ENVIRONMENT is "integration"', () => {
      // Verified indirectly via createTransaction call
      mockFetchOk({ token: 'tbk-token-001', url: `${BASE_URL}/redirect` });
      svc.createTransaction('order-1', 10_000, 'http://return');

      const [url] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain('webpay3gint.transbank.cl');
    });
  });

  // ─── createTransaction ───────────────────────────────────

  describe('createTransaction', () => {
    const tbkResponse = {
      token: 'tbk-token-abc123',
      url: 'https://webpay3gint.transbank.cl/redirect',
    };

    it('returns token and redirect URL with token_ws appended', async () => {
      mockFetchOk(tbkResponse);

      const result = await svc.createTransaction('WP-2026-AABB', 10_000, 'http://return');

      expect(result.token).toBe('tbk-token-abc123');
      expect(result.url).toBe(`${tbkResponse.url}?token_ws=${tbkResponse.token}`);
    });

    it('POSTs to the correct Transbank endpoint', async () => {
      mockFetchOk(tbkResponse);
      await svc.createTransaction('WP-2026-AABB', 10_000, 'http://return');

      const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain('/rswebpaytransaction/api/webpay/v1.2/transactions');
      expect(options.method).toBe('POST');
    });

    it('includes correct Tbk-Api-Key-Id and Tbk-Api-Key-Secret headers', async () => {
      mockFetchOk(tbkResponse);
      await svc.createTransaction('WP-2026-AABB', 10_000, 'http://return');

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(options.headers['Tbk-Api-Key-Id']).toBe('597055555532');
      expect(options.headers['Tbk-Api-Key-Secret']).toBe('test-api-key');
    });

    it('sends buy_order and amount in JSON body', async () => {
      mockFetchOk(tbkResponse);
      await svc.createTransaction('MY-ORDER-001', 25_000, 'http://return');

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.buy_order).toBe('MY-ORDER-001');
      expect(body.amount).toBe(25_000);
      expect(body.return_url).toBe('http://return');
    });

    it('uses a UUID for session_id (not Date.now)', async () => {
      mockFetchOk(tbkResponse);
      await svc.createTransaction('order', 10_000, 'http://return');

      const [, options] = (global.fetch as jest.Mock).mock.calls[0];
      const body = JSON.parse(options.body);
      // UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      expect(body.session_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('throws on Transbank API error', async () => {
      mockFetchError(422);
      await expect(svc.createTransaction('order', 10_000, 'http://return')).rejects.toThrow(
        'Transbank error: 422',
      );
    });
  });

  // ─── confirmTransaction ──────────────────────────────────

  describe('confirmTransaction', () => {
    const authorizedResponse = {
      response_code: 0,
      amount: 10_000,
      buy_order: 'WP-2026-AABB',
      authorization_code: 'AUTH001',
      transaction_date: '2026-02-27T21:00:00Z',
      card_detail: { card_number: '6623' },
      payment_type_code: 'VN',
    };

    it('returns AUTHORIZED status when response_code is 0', async () => {
      mockFetchOk(authorizedResponse);

      const result = await svc.confirmTransaction('tbk-token-001');

      expect(result.status).toBe('AUTHORIZED');
      expect(result.amount).toBe(10_000);
      expect(result.buyOrder).toBe('WP-2026-AABB');
      expect(result.cardLast4).toBe('6623');
      expect(result.paymentType).toBe('VN');
    });

    it('returns FAILED status when response_code is non-zero', async () => {
      mockFetchOk({ ...authorizedResponse, response_code: -8 });

      const result = await svc.confirmTransaction('tbk-token-001');

      expect(result.status).toBe('FAILED');
    });

    it('PUTs to the correct endpoint with token in path', async () => {
      mockFetchOk(authorizedResponse);
      await svc.confirmTransaction('MY-TBK-TOKEN');

      const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain('/MY-TBK-TOKEN');
      expect(options.method).toBe('PUT');
    });

    it('returns FAILED with amount 0 on HTTP error (does not throw)', async () => {
      mockFetchError(500);

      const result = await svc.confirmTransaction('bad-token');

      expect(result.status).toBe('FAILED');
      expect(result.amount).toBe(0);
    });

    it('handles missing card_detail gracefully (null cardLast4)', async () => {
      const noCard = { ...authorizedResponse, card_detail: undefined };
      mockFetchOk(noCard);

      const result = await svc.confirmTransaction('token');
      expect(result.cardLast4).toBeUndefined();
    });
  });

  // ─── refundTransaction ───────────────────────────────────

  describe('refundTransaction', () => {
    it('returns true on successful refund', async () => {
      mockFetchOk({});
      const result = await svc.refundTransaction('token-abc', 5_000);
      expect(result).toBe(true);
    });

    it('POSTs to the refunds endpoint with correct amount', async () => {
      mockFetchOk({});
      await svc.refundTransaction('MY-TOKEN', 8_500);

      const [url, options] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toContain('/MY-TOKEN/refunds');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body).amount).toBe(8_500);
    });

    it('returns false on refund API error (does not throw)', async () => {
      mockFetchError(422);
      const result = await svc.refundTransaction('token', 5_000);
      expect(result).toBe(false);
    });
  });
});
