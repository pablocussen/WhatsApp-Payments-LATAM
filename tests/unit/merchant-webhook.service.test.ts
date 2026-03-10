/**
 * Unit tests for MerchantWebhookService.
 * Redis is fully mocked.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test' },
}));

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  }),
}));

import { MerchantWebhookService } from '../../src/services/merchant-webhook.service';
import type { MerchantWebhook, WebhookDelivery } from '../../src/services/merchant-webhook.service';

describe('MerchantWebhookService', () => {
  let svc: MerchantWebhookService;

  beforeEach(() => {
    svc = new MerchantWebhookService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
  });

  const validInput = {
    merchantId: 'm-1',
    url: 'https://merchant.com/webhooks',
    events: ['payment.completed' as const, 'refund.created' as const],
  };

  // ─── registerWebhook ───────────────────────────────────

  describe('registerWebhook', () => {
    it('creates webhook with wh_ prefix', async () => {
      const hook = await svc.registerWebhook(validInput);
      expect(hook.id).toMatch(/^wh_[0-9a-f]{16}$/);
      expect(hook.merchantId).toBe('m-1');
      expect(hook.url).toBe('https://merchant.com/webhooks');
      expect(hook.events).toEqual(['payment.completed', 'refund.created']);
      expect(hook.status).toBe('active');
      expect(hook.secret).toMatch(/^whsec_[0-9a-f]{48}$/);
      expect(hook.failureCount).toBe(0);
    });

    it('deduplicates events', async () => {
      const hook = await svc.registerWebhook({
        ...validInput,
        events: ['payment.completed', 'payment.completed', 'refund.created'],
      });
      expect(hook.events).toHaveLength(2);
    });

    it('saves to Redis', async () => {
      await svc.registerWebhook(validInput);
      expect(mockRedisSet).toHaveBeenCalledWith(
        expect.stringMatching(/^mwh:hook:wh_/),
        expect.any(String),
        { EX: 365 * 24 * 60 * 60 },
      );
    });

    it('adds to merchant webhook list', async () => {
      await svc.registerWebhook(validInput);
      expect(mockRedisSet).toHaveBeenCalledWith(
        'mwh:merchant:m-1',
        expect.any(String),
        { EX: 365 * 24 * 60 * 60 },
      );
    });

    it('accepts description', async () => {
      const hook = await svc.registerWebhook({ ...validInput, description: 'Payment notifications' });
      expect(hook.description).toBe('Payment notifications');
    });

    it('rejects empty merchantId', async () => {
      await expect(svc.registerWebhook({ ...validInput, merchantId: '' }))
        .rejects.toThrow('merchantId');
    });

    it('rejects invalid URL', async () => {
      await expect(svc.registerWebhook({ ...validInput, url: 'not-a-url' }))
        .rejects.toThrow('URL');
    });

    it('rejects HTTP URL', async () => {
      await expect(svc.registerWebhook({ ...validInput, url: 'http://merchant.com/hook' }))
        .rejects.toThrow('HTTPS');
    });

    it('rejects empty events', async () => {
      await expect(svc.registerWebhook({ ...validInput, events: [] }))
        .rejects.toThrow('al menos un evento');
    });

    it('rejects invalid events', async () => {
      await expect(svc.registerWebhook({ ...validInput, events: ['invalid.event' as any] }))
        .rejects.toThrow('inválidos');
    });

    it('does not throw on Redis error', async () => {
      mockRedisSet.mockRejectedValue(new Error('Redis down'));
      const hook = await svc.registerWebhook(validInput);
      expect(hook.id).toBeDefined();
    });
  });

  // ─── getWebhook ────────────────────────────────────────

  describe('getWebhook', () => {
    it('returns stored webhook', async () => {
      const hook: MerchantWebhook = {
        id: 'wh_abc', merchantId: 'm-1', url: 'https://m.com/h',
        secret: 'whsec_abc', events: ['payment.completed'], status: 'active',
        description: null, failureCount: 0, lastDeliveryAt: null,
        lastFailureAt: null, lastFailureReason: null,
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(hook));
      const result = await svc.getWebhook('wh_abc');
      expect(result).not.toBeNull();
      expect(result!.id).toBe('wh_abc');
    });

    it('returns null when not found', async () => {
      expect(await svc.getWebhook('wh_unknown')).toBeNull();
    });

    it('returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.getWebhook('wh_abc')).toBeNull();
    });
  });

  // ─── getMerchantWebhooks ───────────────────────────────

  describe('getMerchantWebhooks', () => {
    it('returns webhooks for merchant', async () => {
      const hook: MerchantWebhook = {
        id: 'wh_1', merchantId: 'm-1', url: 'https://m.com/h',
        secret: 'whsec_abc', events: ['payment.completed'], status: 'active',
        description: null, failureCount: 0, lastDeliveryAt: null,
        lastFailureAt: null, lastFailureReason: null,
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
      };
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'mwh:merchant:m-1') return Promise.resolve(JSON.stringify(['wh_1']));
        if (key === 'mwh:hook:wh_1') return Promise.resolve(JSON.stringify(hook));
        return Promise.resolve(null);
      });

      const result = await svc.getMerchantWebhooks('m-1');
      expect(result).toHaveLength(1);
    });

    it('returns empty when none', async () => {
      expect(await svc.getMerchantWebhooks('m-none')).toEqual([]);
    });

    it('returns empty on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.getMerchantWebhooks('m-1')).toEqual([]);
    });
  });

  // ─── updateWebhook ─────────────────────────────────────

  describe('updateWebhook', () => {
    const existing: MerchantWebhook = {
      id: 'wh_upd', merchantId: 'm-1', url: 'https://old.com/h',
      secret: 'whsec_old', events: ['payment.completed'], status: 'active',
      description: 'Old desc', failureCount: 3, lastDeliveryAt: null,
      lastFailureAt: null, lastFailureReason: null,
      createdAt: '2026-01-01', updatedAt: '2026-01-01',
    };

    it('updates URL', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(existing));
      const result = await svc.updateWebhook('wh_upd', { url: 'https://new.com/hook' });
      expect(result).not.toBeNull();
      expect(result!.url).toBe('https://new.com/hook');
    });

    it('updates events', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(existing));
      const result = await svc.updateWebhook('wh_upd', { events: ['refund.created', 'settlement.completed'] });
      expect(result!.events).toEqual(['refund.created', 'settlement.completed']);
    });

    it('updates description', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(existing));
      const result = await svc.updateWebhook('wh_upd', { description: 'New desc' });
      expect(result!.description).toBe('New desc');
    });

    it('resets failure count when re-enabled', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ ...existing, status: 'failing', failureCount: 10 }));
      const result = await svc.updateWebhook('wh_upd', { status: 'active' });
      expect(result!.status).toBe('active');
      expect(result!.failureCount).toBe(0);
    });

    it('throws for invalid URL', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(existing));
      await expect(svc.updateWebhook('wh_upd', { url: 'not-url' }))
        .rejects.toThrow('URL');
    });

    it('throws for empty events', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(existing));
      await expect(svc.updateWebhook('wh_upd', { events: [] }))
        .rejects.toThrow('al menos un evento');
    });

    it('throws for invalid events', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(existing));
      await expect(svc.updateWebhook('wh_upd', { events: ['bad.event' as any] }))
        .rejects.toThrow('inválidos');
    });

    it('returns null for unknown webhook', async () => {
      expect(await svc.updateWebhook('wh_unknown', { description: 'x' })).toBeNull();
    });

    it('returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.updateWebhook('wh_upd', { description: 'x' })).toBeNull();
    });
  });

  // ─── rotateSecret ──────────────────────────────────────

  describe('rotateSecret', () => {
    const existing: MerchantWebhook = {
      id: 'wh_rot', merchantId: 'm-1', url: 'https://m.com/h',
      secret: 'whsec_old_secret', events: ['payment.completed'], status: 'active',
      description: null, failureCount: 0, lastDeliveryAt: null,
      lastFailureAt: null, lastFailureReason: null,
      createdAt: '2026-01-01', updatedAt: '2026-01-01',
    };

    it('generates new secret', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(existing));
      const result = await svc.rotateSecret('wh_rot');
      expect(result).not.toBeNull();
      expect(result!.newSecret).toMatch(/^whsec_[0-9a-f]{48}$/);
      expect(result!.newSecret).not.toBe('whsec_old_secret');
    });

    it('returns null for unknown webhook', async () => {
      expect(await svc.rotateSecret('wh_unknown')).toBeNull();
    });

    it('returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.rotateSecret('wh_rot')).toBeNull();
    });
  });

  // ─── deleteWebhook ─────────────────────────────────────

  describe('deleteWebhook', () => {
    const existing: MerchantWebhook = {
      id: 'wh_del', merchantId: 'm-1', url: 'https://m.com/h',
      secret: 'whsec_x', events: ['payment.completed'], status: 'active',
      description: null, failureCount: 0, lastDeliveryAt: null,
      lastFailureAt: null, lastFailureReason: null,
      createdAt: '2026-01-01', updatedAt: '2026-01-01',
    };

    it('soft-deletes webhook', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(existing));
      const result = await svc.deleteWebhook('wh_del');
      expect(result).toBe(true);
      // Verify it was saved with disabled status
      const savedCall = mockRedisSet.mock.calls.find(
        (c: unknown[]) => (c[0] as string) === 'mwh:hook:wh_del',
      );
      expect(savedCall).toBeDefined();
      const saved = JSON.parse(savedCall![1] as string);
      expect(saved.status).toBe('disabled');
    });

    it('returns false for unknown webhook', async () => {
      expect(await svc.deleteWebhook('wh_unknown')).toBe(false);
    });

    it('returns false on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.deleteWebhook('wh_del')).toBe(false);
    });
  });

  // ─── recordDelivery ────────────────────────────────────

  describe('recordDelivery', () => {
    const webhookData: MerchantWebhook = {
      id: 'wh_dlv', merchantId: 'm-1', url: 'https://m.com/h',
      secret: 'whsec_x', events: ['payment.completed'], status: 'active',
      description: null, failureCount: 0, lastDeliveryAt: null,
      lastFailureAt: null, lastFailureReason: null,
      createdAt: '2026-01-01', updatedAt: '2026-01-01',
    };

    it('records successful delivery', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'mwh:hook:wh_dlv') return Promise.resolve(JSON.stringify(webhookData));
        return Promise.resolve(null);
      });

      const d = await svc.recordDelivery({
        webhookId: 'wh_dlv',
        event: 'payment.completed',
        payload: '{"id":"pay_1"}',
        responseStatus: 200,
        responseBody: 'OK',
        success: true,
        duration: 150,
        attempt: 1,
      });

      expect(d.id).toMatch(/^dlv_/);
      expect(d.success).toBe(true);
      expect(d.duration).toBe(150);
    });

    it('records failed delivery', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'mwh:hook:wh_dlv') return Promise.resolve(JSON.stringify(webhookData));
        return Promise.resolve(null);
      });

      const d = await svc.recordDelivery({
        webhookId: 'wh_dlv',
        event: 'payment.completed',
        payload: '{"id":"pay_1"}',
        responseStatus: 500,
        responseBody: 'Internal error',
        success: false,
        duration: 3000,
        attempt: 1,
      });

      expect(d.success).toBe(false);
      expect(d.responseStatus).toBe(500);
    });

    it('does not throw on Redis error', async () => {
      mockRedisSet.mockRejectedValue(new Error('Redis down'));
      const d = await svc.recordDelivery({
        webhookId: 'wh_dlv',
        event: 'payment.completed',
        payload: '{}',
        responseStatus: null,
        responseBody: null,
        success: false,
        duration: 0,
        attempt: 1,
      });
      expect(d.id).toBeDefined();
    });
  });

  // ─── getDeliveries ─────────────────────────────────────

  describe('getDeliveries', () => {
    it('returns deliveries newest first', async () => {
      const d1: WebhookDelivery = {
        id: 'dlv_1', webhookId: 'wh_1', event: 'payment.completed',
        payload: '{}', responseStatus: 200, responseBody: 'OK',
        success: true, duration: 100, attempt: 1, deliveredAt: '2026-01-01',
      };
      const d2: WebhookDelivery = {
        id: 'dlv_2', webhookId: 'wh_1', event: 'refund.created',
        payload: '{}', responseStatus: 200, responseBody: 'OK',
        success: true, duration: 120, attempt: 1, deliveredAt: '2026-01-02',
      };

      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'mwh:hook-deliveries:wh_1') return Promise.resolve(JSON.stringify(['dlv_1', 'dlv_2']));
        if (key === 'mwh:delivery:dlv_1') return Promise.resolve(JSON.stringify(d1));
        if (key === 'mwh:delivery:dlv_2') return Promise.resolve(JSON.stringify(d2));
        return Promise.resolve(null);
      });

      const result = await svc.getDeliveries('wh_1');
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('dlv_2'); // newest first
    });

    it('returns empty when none', async () => {
      expect(await svc.getDeliveries('wh_none')).toEqual([]);
    });

    it('returns empty on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.getDeliveries('wh_1')).toEqual([]);
    });

    it('respects limit', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'mwh:hook-deliveries:wh_1') return Promise.resolve(JSON.stringify(['dlv_1', 'dlv_2', 'dlv_3']));
        if (key.startsWith('mwh:delivery:')) {
          return Promise.resolve(JSON.stringify({
            id: key.replace('mwh:delivery:', ''), webhookId: 'wh_1', event: 'payment.completed',
            payload: '{}', responseStatus: 200, responseBody: 'OK',
            success: true, duration: 100, attempt: 1, deliveredAt: '2026-01-01',
          }));
        }
        return Promise.resolve(null);
      });

      const result = await svc.getDeliveries('wh_1', 2);
      expect(result).toHaveLength(2);
    });
  });

  // ─── signPayload / verifySignature ─────────────────────

  describe('signPayload & verifySignature', () => {
    it('signs and verifies payload', () => {
      const payload = '{"event":"payment.completed","data":{"id":"pay_1"}}';
      const secret = 'whsec_test_secret';
      const sig = svc.signPayload(payload, secret);
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
      expect(svc.verifySignature(payload, secret, sig)).toBe(true);
    });

    it('rejects wrong signature', () => {
      const payload = '{"event":"test"}';
      const secret = 'whsec_test';
      expect(svc.verifySignature(payload, secret, 'wrong_signature')).toBe(false);
    });

    it('rejects tampered payload', () => {
      const secret = 'whsec_test';
      const sig = svc.signPayload('original', secret);
      expect(svc.verifySignature('tampered', secret, sig)).toBe(false);
    });

    it('rejects wrong secret', () => {
      const payload = '{"event":"test"}';
      const sig = svc.signPayload(payload, 'secret_a');
      expect(svc.verifySignature(payload, 'secret_b', sig)).toBe(false);
    });
  });

  // ─── getWebhooksForEvent ───────────────────────────────

  describe('getWebhooksForEvent', () => {
    it('returns active webhooks subscribed to event', async () => {
      const hook1: MerchantWebhook = {
        id: 'wh_1', merchantId: 'm-1', url: 'https://m.com/h1',
        secret: 'whsec_1', events: ['payment.completed', 'refund.created'], status: 'active',
        description: null, failureCount: 0, lastDeliveryAt: null,
        lastFailureAt: null, lastFailureReason: null,
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
      };
      const hook2: MerchantWebhook = {
        id: 'wh_2', merchantId: 'm-1', url: 'https://m.com/h2',
        secret: 'whsec_2', events: ['settlement.completed'], status: 'active',
        description: null, failureCount: 0, lastDeliveryAt: null,
        lastFailureAt: null, lastFailureReason: null,
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
      };
      const hook3: MerchantWebhook = {
        id: 'wh_3', merchantId: 'm-1', url: 'https://m.com/h3',
        secret: 'whsec_3', events: ['payment.completed'], status: 'disabled',
        description: null, failureCount: 0, lastDeliveryAt: null,
        lastFailureAt: null, lastFailureReason: null,
        createdAt: '2026-01-01', updatedAt: '2026-01-01',
      };

      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'mwh:merchant:m-1') return Promise.resolve(JSON.stringify(['wh_1', 'wh_2', 'wh_3']));
        if (key === 'mwh:hook:wh_1') return Promise.resolve(JSON.stringify(hook1));
        if (key === 'mwh:hook:wh_2') return Promise.resolve(JSON.stringify(hook2));
        if (key === 'mwh:hook:wh_3') return Promise.resolve(JSON.stringify(hook3));
        return Promise.resolve(null);
      });

      const result = await svc.getWebhooksForEvent('m-1', 'payment.completed');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('wh_1');
    });

    it('returns empty when no match', async () => {
      const result = await svc.getWebhooksForEvent('m-none', 'payment.completed');
      expect(result).toEqual([]);
    });
  });

  // ─── getDeliveryStats ──────────────────────────────────

  describe('getDeliveryStats', () => {
    it('calculates delivery statistics', async () => {
      const deliveries: WebhookDelivery[] = [
        { id: 'dlv_1', webhookId: 'wh_1', event: 'payment.completed', payload: '{}', responseStatus: 200, responseBody: 'OK', success: true, duration: 100, attempt: 1, deliveredAt: '2026-01-01' },
        { id: 'dlv_2', webhookId: 'wh_1', event: 'payment.completed', payload: '{}', responseStatus: 200, responseBody: 'OK', success: true, duration: 200, attempt: 1, deliveredAt: '2026-01-02' },
        { id: 'dlv_3', webhookId: 'wh_1', event: 'refund.created', payload: '{}', responseStatus: 500, responseBody: 'error', success: false, duration: 3000, attempt: 1, deliveredAt: '2026-01-03' },
      ];

      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'mwh:hook-deliveries:wh_1') return Promise.resolve(JSON.stringify(['dlv_1', 'dlv_2', 'dlv_3']));
        const d = deliveries.find((x) => `mwh:delivery:${x.id}` === key);
        return Promise.resolve(d ? JSON.stringify(d) : null);
      });

      const stats = await svc.getDeliveryStats('wh_1');
      expect(stats.total).toBe(3);
      expect(stats.successful).toBe(2);
      expect(stats.failed).toBe(1);
      expect(stats.avgDuration).toBe(1100); // (100+200+3000)/3
    });

    it('returns zeros when no deliveries', async () => {
      const stats = await svc.getDeliveryStats('wh_none');
      expect(stats.total).toBe(0);
      expect(stats.avgDuration).toBe(0);
    });
  });
});
