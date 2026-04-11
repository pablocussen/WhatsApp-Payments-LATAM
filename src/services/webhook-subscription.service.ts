import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('webhook-sub');

const SUB_PREFIX = 'whsub:';
const SUB_TTL = 365 * 24 * 60 * 60;
const MAX_SUBS = 10;

export type WebhookEvent =
  | 'payment.completed' | 'payment.failed' | 'payment.refunded'
  | 'payout.completed' | 'payout.failed'
  | 'dispute.opened' | 'dispute.resolved'
  | 'customer.created' | 'invoice.paid'
  | 'link.used' | 'link.expired';

export interface WebhookSubscription {
  id: string;
  merchantId: string;
  url: string;
  events: WebhookEvent[];
  secret: string;
  active: boolean;
  failCount: number;
  lastDeliveredAt: string | null;
  lastFailedAt: string | null;
  createdAt: string;
}

const ALL_EVENTS: WebhookEvent[] = [
  'payment.completed', 'payment.failed', 'payment.refunded',
  'payout.completed', 'payout.failed',
  'dispute.opened', 'dispute.resolved',
  'customer.created', 'invoice.paid',
  'link.used', 'link.expired',
];

export class WebhookSubscriptionService {
  async createSubscription(input: {
    merchantId: string;
    url: string;
    events: WebhookEvent[];
  }): Promise<WebhookSubscription> {
    if (!input.url.startsWith('https://')) throw new Error('URL debe usar HTTPS.');
    if (!input.events.length) throw new Error('Debe suscribirse a al menos un evento.');
    for (const e of input.events) {
      if (!ALL_EVENTS.includes(e)) throw new Error(`Evento inválido: ${e}`);
    }

    const subs = await this.getSubscriptions(input.merchantId);
    if (subs.length >= MAX_SUBS) throw new Error(`Máximo ${MAX_SUBS} suscripciones.`);

    const sub: WebhookSubscription = {
      id: `whsub_${Date.now().toString(36)}`,
      merchantId: input.merchantId,
      url: input.url,
      events: input.events,
      secret: this.generateSecret(),
      active: true,
      failCount: 0,
      lastDeliveredAt: null,
      lastFailedAt: null,
      createdAt: new Date().toISOString(),
    };

    subs.push(sub);
    await this.save(input.merchantId, subs);

    log.info('Webhook subscription created', { merchantId: input.merchantId, subId: sub.id, events: input.events });
    return sub;
  }

  async getSubscriptions(merchantId: string): Promise<WebhookSubscription[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${SUB_PREFIX}${merchantId}`);
      return raw ? JSON.parse(raw) as WebhookSubscription[] : [];
    } catch {
      return [];
    }
  }

  async getSubscriptionsForEvent(merchantId: string, event: WebhookEvent): Promise<WebhookSubscription[]> {
    const subs = await this.getSubscriptions(merchantId);
    return subs.filter(s => s.active && s.events.includes(event) && s.failCount < 5);
  }

  async recordDelivery(merchantId: string, subId: string, success: boolean): Promise<void> {
    const subs = await this.getSubscriptions(merchantId);
    const sub = subs.find(s => s.id === subId);
    if (!sub) return;

    if (success) {
      sub.lastDeliveredAt = new Date().toISOString();
      sub.failCount = 0;
    } else {
      sub.lastFailedAt = new Date().toISOString();
      sub.failCount++;
      if (sub.failCount >= 5) {
        sub.active = false;
        log.warn('Webhook subscription disabled after 5 failures', { subId, merchantId });
      }
    }

    await this.save(merchantId, subs);
  }

  async deleteSubscription(merchantId: string, subId: string): Promise<boolean> {
    const subs = await this.getSubscriptions(merchantId);
    const filtered = subs.filter(s => s.id !== subId);
    if (filtered.length === subs.length) return false;
    await this.save(merchantId, filtered);
    return true;
  }

  getSupportedEvents(): WebhookEvent[] {
    return [...ALL_EVENTS];
  }

  private generateSecret(): string {
    return 'whsec_' + Array.from({ length: 32 }, () => Math.random().toString(36)[2]).join('');
  }

  private async save(merchantId: string, subs: WebhookSubscription[]): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${SUB_PREFIX}${merchantId}`, JSON.stringify(subs), { EX: SUB_TTL });
    } catch (err) {
      log.warn('Failed to save subscriptions', { merchantId, error: (err as Error).message });
    }
  }
}

export const webhookSubscriptions = new WebhookSubscriptionService();
