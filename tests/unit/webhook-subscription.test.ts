/**
 * WebhookSubscriptionService — gestión de suscripciones webhook.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { WebhookSubscriptionService } from '../../src/services/webhook-subscription.service';

describe('WebhookSubscriptionService', () => {
  let service: WebhookSubscriptionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new WebhookSubscriptionService();
    mockRedisGet.mockResolvedValue(null);
  });

  it('creates subscription', async () => {
    const sub = await service.createSubscription({
      merchantId: 'm1', url: 'https://merchant.cl/webhook', events: ['payment.completed'],
    });
    expect(sub.id).toMatch(/^whsub_/);
    expect(sub.secret).toMatch(/^whsec_/);
    expect(sub.events).toEqual(['payment.completed']);
    expect(sub.active).toBe(true);
    expect(sub.failCount).toBe(0);
  });

  it('rejects HTTP url', async () => {
    await expect(service.createSubscription({
      merchantId: 'm1', url: 'http://merchant.cl/webhook', events: ['payment.completed'],
    })).rejects.toThrow('HTTPS');
  });

  it('rejects empty events', async () => {
    await expect(service.createSubscription({
      merchantId: 'm1', url: 'https://merchant.cl/webhook', events: [],
    })).rejects.toThrow('al menos un');
  });

  it('rejects invalid event', async () => {
    await expect(service.createSubscription({
      merchantId: 'm1', url: 'https://merchant.cl/webhook', events: ['invalid.event' as any],
    })).rejects.toThrow('inválido');
  });

  it('rejects over 10 subscriptions', async () => {
    const existing = Array.from({ length: 10 }, (_, i) => ({ id: `whsub_${i}` }));
    mockRedisGet.mockResolvedValue(JSON.stringify(existing));
    await expect(service.createSubscription({
      merchantId: 'm1', url: 'https://merchant.cl/webhook', events: ['payment.completed'],
    })).rejects.toThrow('10');
  });

  it('filters subscriptions for event', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 's1', active: true, events: ['payment.completed', 'payment.failed'], failCount: 0 },
      { id: 's2', active: true, events: ['dispute.opened'], failCount: 0 },
      { id: 's3', active: false, events: ['payment.completed'], failCount: 0 },
      { id: 's4', active: true, events: ['payment.completed'], failCount: 5 },
    ]));
    const subs = await service.getSubscriptionsForEvent('m1', 'payment.completed');
    expect(subs).toHaveLength(1);
    expect(subs[0].id).toBe('s1');
  });

  it('records successful delivery', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 's1', failCount: 2, lastDeliveredAt: null, active: true },
    ]));
    await service.recordDelivery('m1', 's1', true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].failCount).toBe(0);
    expect(saved[0].lastDeliveredAt).toBeDefined();
  });

  it('disables after 5 failures', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 's1', failCount: 4, active: true },
    ]));
    await service.recordDelivery('m1', 's1', false);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].failCount).toBe(5);
    expect(saved[0].active).toBe(false);
  });

  it('deletes subscription', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 's1' }, { id: 's2' },
    ]));
    expect(await service.deleteSubscription('m1', 's1')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved).toHaveLength(1);
  });

  it('returns all supported events', () => {
    const events = service.getSupportedEvents();
    expect(events).toContain('payment.completed');
    expect(events).toContain('dispute.opened');
    expect(events).toContain('invoice.paid');
    expect(events.length).toBe(11);
  });
});
