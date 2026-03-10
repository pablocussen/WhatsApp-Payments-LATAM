/**
 * Unit tests for WebhookEventsService.
 * Redis and fetch are fully mocked.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisLPush = jest.fn().mockResolvedValue(1);
const mockRedisLTrim = jest.fn().mockResolvedValue('OK');
const mockRedisExpire = jest.fn().mockResolvedValue(1);
const mockRedisLRange = jest.fn().mockResolvedValue([]);

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test' },
}));

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    lPush: (...args: unknown[]) => mockRedisLPush(...args),
    lTrim: (...args: unknown[]) => mockRedisLTrim(...args),
    expire: (...args: unknown[]) => mockRedisExpire(...args),
    lRange: (...args: unknown[]) => mockRedisLRange(...args),
  }),
}));

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

import { WebhookEventsService } from '../../src/services/webhook-events.service';
import type { WebhookSubscription } from '../../src/services/webhook-events.service';

describe('WebhookEventsService', () => {
  let svc: WebhookEventsService;

  beforeEach(() => {
    svc = new WebhookEventsService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockFetch.mockResolvedValue({ ok: true, status: 200 });
  });

  // ─── subscribe ───────────────────────────────────────

  describe('subscribe', () => {
    it('creates a subscription with secret', async () => {
      const sub = await svc.subscribe('https://example.com/hook', ['payment.completed']);
      expect(sub.id).toBeDefined();
      expect(sub.url).toBe('https://example.com/hook');
      expect(sub.secret).toHaveLength(64); // 32 bytes hex
      expect(sub.events).toEqual(['payment.completed']);
      expect(sub.active).toBe(true);
      expect(mockRedisSet).toHaveBeenCalledWith('webhook:subscriptions', expect.any(String));
    });

    it('appends to existing subscriptions', async () => {
      const existing: WebhookSubscription[] = [{
        id: 'old', url: 'https://old.com', secret: 'x', events: ['user.created'], active: true, createdAt: '2026-01-01',
      }];
      mockRedisGet.mockResolvedValue(JSON.stringify(existing));

      await svc.subscribe('https://new.com/hook', ['payment.completed']);

      const stored = JSON.parse(mockRedisSet.mock.calls[0][1]);
      expect(stored).toHaveLength(2);
    });
  });

  // ─── unsubscribe ─────────────────────────────────────

  describe('unsubscribe', () => {
    it('removes a subscription', async () => {
      const subs: WebhookSubscription[] = [
        { id: 'sub1', url: 'https://a.com', secret: 'x', events: ['payment.completed'], active: true, createdAt: '2026-01-01' },
        { id: 'sub2', url: 'https://b.com', secret: 'y', events: ['user.created'], active: true, createdAt: '2026-01-01' },
      ];
      mockRedisGet.mockResolvedValue(JSON.stringify(subs));

      const result = await svc.unsubscribe('sub1');
      expect(result).toBe(true);

      const stored = JSON.parse(mockRedisSet.mock.calls[0][1]);
      expect(stored).toHaveLength(1);
      expect(stored[0].id).toBe('sub2');
    });

    it('returns false for unknown subscription', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify([]));
      const result = await svc.unsubscribe('nonexistent');
      expect(result).toBe(false);
    });
  });

  // ─── getSubscriptions ────────────────────────────────

  describe('getSubscriptions', () => {
    it('returns empty array when none stored', async () => {
      const result = await svc.getSubscriptions();
      expect(result).toEqual([]);
    });

    it('returns empty on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const result = await svc.getSubscriptions();
      expect(result).toEqual([]);
    });
  });

  // ─── dispatch ────────────────────────────────────────

  describe('dispatch', () => {
    it('delivers to matching subscriptions', async () => {
      const subs: WebhookSubscription[] = [{
        id: 'sub1', url: 'https://hook.example.com', secret: 'mysecret',
        events: ['payment.completed'], active: true, createdAt: '2026-01-01',
      }];
      mockRedisGet.mockResolvedValue(JSON.stringify(subs));

      await svc.dispatch('payment.completed', { amount: 10000, reference: '#WP-001' });

      // Wait for async delivery
      await new Promise((r) => setTimeout(r, 50));

      expect(mockFetch).toHaveBeenCalledWith(
        'https://hook.example.com',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'X-WhatPay-Event': 'payment.completed',
          }),
        }),
      );
    });

    it('skips inactive subscriptions', async () => {
      const subs: WebhookSubscription[] = [{
        id: 'sub1', url: 'https://hook.example.com', secret: 'mysecret',
        events: ['payment.completed'], active: false, createdAt: '2026-01-01',
      }];
      mockRedisGet.mockResolvedValue(JSON.stringify(subs));

      await svc.dispatch('payment.completed', { amount: 10000 });
      await new Promise((r) => setTimeout(r, 50));

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('skips subscriptions for non-matching events', async () => {
      const subs: WebhookSubscription[] = [{
        id: 'sub1', url: 'https://hook.example.com', secret: 'mysecret',
        events: ['user.created'], active: true, createdAt: '2026-01-01',
      }];
      mockRedisGet.mockResolvedValue(JSON.stringify(subs));

      await svc.dispatch('payment.completed', { amount: 10000 });
      await new Promise((r) => setTimeout(r, 50));

      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('does not throw on dispatch error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      await expect(svc.dispatch('payment.completed', {})).resolves.toBeUndefined();
    });

    it('logs event to Redis', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify([]));
      await svc.dispatch('payment.completed', { amount: 5000 });

      expect(mockRedisLPush).toHaveBeenCalledWith(
        'webhook:log:all',
        expect.stringContaining('payment.completed'),
      );
    });
  });

  // ─── getEventLog ─────────────────────────────────────

  describe('getEventLog', () => {
    it('returns parsed events', async () => {
      const event = { id: 'evt1', type: 'payment.completed', timestamp: '2026-03-09', data: {} };
      mockRedisLRange.mockResolvedValue([JSON.stringify(event)]);

      const result = await svc.getEventLog();
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('payment.completed');
    });

    it('returns empty on Redis error', async () => {
      mockRedisLRange.mockRejectedValue(new Error('Redis down'));
      const result = await svc.getEventLog();
      expect(result).toEqual([]);
    });
  });

  // ─── HMAC signature ──────────────────────────────────

  describe('HMAC delivery', () => {
    it('includes X-WhatPay-Signature header', async () => {
      const subs: WebhookSubscription[] = [{
        id: 'sub1', url: 'https://hook.example.com', secret: 'test-secret',
        events: ['payment.completed'], active: true, createdAt: '2026-01-01',
      }];
      mockRedisGet.mockResolvedValue(JSON.stringify(subs));

      await svc.dispatch('payment.completed', { test: true });
      await new Promise((r) => setTimeout(r, 50));

      const call = mockFetch.mock.calls[0];
      expect(call[1].headers['X-WhatPay-Signature']).toMatch(/^sha256=[0-9a-f]{64}$/);
    });
  });
});
