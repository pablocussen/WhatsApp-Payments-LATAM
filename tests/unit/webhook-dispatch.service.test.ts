/**
 * WebhookDispatchService — delivers webhook events to merchant URLs.
 */

const mockGetWebhooksForEvent = jest.fn();
const mockSignPayload = jest.fn().mockReturnValue('test-signature');
const mockRecordDelivery = jest.fn().mockResolvedValue({});
const mockFetch = jest.fn();

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    sMembers: jest.fn().mockResolvedValue([]),
    sAdd: jest.fn(), sRem: jest.fn(),
    lPush: jest.fn(), lRange: jest.fn().mockResolvedValue([]), lTrim: jest.fn(),
    expire: jest.fn().mockResolvedValue(true),
    multi: jest.fn().mockReturnValue({
      incr: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(), lPush: jest.fn().mockReturnThis(),
      lTrim: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([0, 0, 0, 0, 0]),
    }),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test' },
}));

// Mock the MerchantWebhookService methods used by dispatch
jest.mock('../../src/services/merchant-webhook.service', () => ({
  MerchantWebhookService: jest.fn().mockImplementation(() => ({
    getWebhooksForEvent: mockGetWebhooksForEvent,
    signPayload: mockSignPayload,
    recordDelivery: mockRecordDelivery,
  })),
}));

// Mock global fetch
global.fetch = mockFetch as unknown as typeof fetch;

import { WebhookDispatchService } from '../../src/services/webhook-dispatch.service';

describe('WebhookDispatchService', () => {
  let service: WebhookDispatchService;

  const sampleWebhook = {
    id: 'wh_test123',
    merchantId: 'merchant-1',
    url: 'https://merchant.test/webhook',
    secret: 'whsec_test_secret',
    events: ['payment.completed' as const],
    status: 'active' as const,
    description: null,
    failureCount: 0,
    lastDeliveryAt: null,
    lastFailureAt: null,
    lastFailureReason: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebhookDispatchService();
    mockFetch.mockResolvedValue({
      status: 200,
      text: () => Promise.resolve('OK'),
    });
  });

  // ── Basic dispatch ─────────────────────────────────

  it('dispatches to all webhooks for an event', async () => {
    mockGetWebhooksForEvent.mockResolvedValue([sampleWebhook]);

    await service.dispatch('merchant-1', 'payment.completed', {
      transactionId: 'tx-1',
      amount: 5000,
      reference: '#WP-2026-TEST',
    });

    expect(mockGetWebhooksForEvent).toHaveBeenCalledWith('merchant-1', 'payment.completed');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://merchant.test/webhook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-WhatPay-Event': 'payment.completed',
          'User-Agent': 'WhatPay-Webhook/1.0',
        }),
      }),
    );
  });

  it('includes HMAC signature in headers', async () => {
    mockGetWebhooksForEvent.mockResolvedValue([sampleWebhook]);
    mockSignPayload.mockReturnValue('abc123');

    await service.dispatch('merchant-1', 'payment.completed', { amount: 1000 });

    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1].headers['X-WhatPay-Signature']).toBe('sha256=abc123');
    expect(mockSignPayload).toHaveBeenCalledWith(expect.any(String), 'whsec_test_secret');
  });

  it('sends payload with event, timestamp, and data', async () => {
    mockGetWebhooksForEvent.mockResolvedValue([sampleWebhook]);

    await service.dispatch('merchant-1', 'payment.completed', { amount: 3000 });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.event).toBe('payment.completed');
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}/);
    expect(body.data.amount).toBe(3000);
  });

  // ── Delivery recording ─────────────────────────────

  it('records successful delivery', async () => {
    mockGetWebhooksForEvent.mockResolvedValue([sampleWebhook]);

    await service.dispatch('merchant-1', 'payment.completed', { amount: 1000 });

    expect(mockRecordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookId: 'wh_test123',
        event: 'payment.completed',
        success: true,
        responseStatus: 200,
        attempt: 1,
      }),
    );
  });

  it('records failed delivery on HTTP error', async () => {
    mockGetWebhooksForEvent.mockResolvedValue([sampleWebhook]);
    mockFetch.mockResolvedValue({
      status: 500,
      text: () => Promise.resolve('Internal Server Error'),
    });

    await service.dispatch('merchant-1', 'payment.completed', { amount: 1000 });

    expect(mockRecordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookId: 'wh_test123',
        success: false,
        responseStatus: 500,
      }),
    );
  });

  it('records failed delivery on network error', async () => {
    mockGetWebhooksForEvent.mockResolvedValue([sampleWebhook]);
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    await service.dispatch('merchant-1', 'payment.completed', { amount: 1000 });

    expect(mockRecordDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        webhookId: 'wh_test123',
        success: false,
        responseStatus: null,
        responseBody: 'ECONNREFUSED',
      }),
    );
  });

  // ── No webhooks ────────────────────────────────────

  it('does nothing when no webhooks are registered', async () => {
    mockGetWebhooksForEvent.mockResolvedValue([]);

    await service.dispatch('merchant-1', 'payment.completed', { amount: 1000 });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockRecordDelivery).not.toHaveBeenCalled();
  });

  // ── Multiple webhooks ──────────────────────────────

  it('dispatches to multiple webhooks concurrently', async () => {
    const webhook2 = { ...sampleWebhook, id: 'wh_test456', url: 'https://other.test/hook' };
    mockGetWebhooksForEvent.mockResolvedValue([sampleWebhook, webhook2]);

    await service.dispatch('merchant-1', 'payment.completed', { amount: 2000 });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockRecordDelivery).toHaveBeenCalledTimes(2);
  });

  // ── Error resilience ───────────────────────────────

  it('does not throw when dispatch fails entirely', async () => {
    mockGetWebhooksForEvent.mockRejectedValue(new Error('Redis down'));

    await expect(
      service.dispatch('merchant-1', 'payment.completed', { amount: 1000 }),
    ).resolves.not.toThrow();
  });

  it('does not throw when recordDelivery fails', async () => {
    mockGetWebhooksForEvent.mockResolvedValue([sampleWebhook]);
    mockRecordDelivery.mockRejectedValue(new Error('Redis write error'));

    await expect(
      service.dispatch('merchant-1', 'payment.completed', { amount: 1000 }),
    ).resolves.not.toThrow();
  });

  it('one webhook failure does not block others', async () => {
    const webhook2 = { ...sampleWebhook, id: 'wh_test456', url: 'https://other.test/hook' };
    mockGetWebhooksForEvent.mockResolvedValue([sampleWebhook, webhook2]);

    // First webhook fails, second succeeds
    mockFetch
      .mockRejectedValueOnce(new Error('Connection refused'))
      .mockResolvedValueOnce({ status: 200, text: () => Promise.resolve('OK') });

    await service.dispatch('merchant-1', 'payment.completed', { amount: 1000 });

    // Both deliveries should be recorded
    expect(mockRecordDelivery).toHaveBeenCalledTimes(2);
  });

  // ── Different event types ──────────────────────────

  it('dispatches payment.failed events', async () => {
    mockGetWebhooksForEvent.mockResolvedValue([sampleWebhook]);

    await service.dispatch('merchant-1', 'payment.failed', {
      reference: '#WP-FAIL',
      reason: 'Saldo insuficiente',
    });

    expect(mockGetWebhooksForEvent).toHaveBeenCalledWith('merchant-1', 'payment.failed');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.event).toBe('payment.failed');
    expect(body.data.reason).toBe('Saldo insuficiente');
  });

  it('dispatches refund.completed events', async () => {
    mockGetWebhooksForEvent.mockResolvedValue([sampleWebhook]);

    await service.dispatch('merchant-1', 'refund.completed', {
      refundId: 'rf-1',
      amount: 5000,
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.event).toBe('refund.completed');
    expect(body.data.refundId).toBe('rf-1');
  });

  // ── Delivery ID uniqueness ─────────────────────────

  it('generates unique delivery IDs per webhook', async () => {
    const webhook2 = { ...sampleWebhook, id: 'wh_test456', url: 'https://other.test/hook' };
    mockGetWebhooksForEvent.mockResolvedValue([sampleWebhook, webhook2]);

    await service.dispatch('merchant-1', 'payment.completed', { amount: 1000 });

    const deliveryIds = mockFetch.mock.calls.map(
      (call: [string, RequestInit]) => (call[1].headers as Record<string, string>)['X-WhatPay-Delivery'],
    );
    expect(deliveryIds[0]).not.toBe(deliveryIds[1]);
    expect(deliveryIds[0]).toMatch(/^del_/);
    expect(deliveryIds[1]).toMatch(/^del_/);
  });
});
