import { createHmac, randomBytes } from 'crypto';
import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('webhook-events');

// ─── Types ──────────────────────────────────────────────

export type WebhookEventType =
  | 'payment.completed'
  | 'payment.failed'
  | 'payment.refunded'
  | 'topup.completed'
  | 'user.created'
  | 'user.kyc_upgraded';

export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface WebhookSubscription {
  id: string;
  url: string;
  secret: string;
  events: WebhookEventType[];
  active: boolean;
  createdAt: string;
}

const SUBS_KEY = 'webhook:subscriptions';
const LOG_PREFIX = 'webhook:log:';
const LOG_TTL = 7 * 24 * 60 * 60; // 7 days
const MAX_LOG_ENTRIES = 50;

// ─── Service ────────────────────────────────────────────

export class WebhookEventsService {
  /**
   * Register a webhook subscription.
   */
  async subscribe(url: string, events: WebhookEventType[]): Promise<WebhookSubscription> {
    const sub: WebhookSubscription = {
      id: randomBytes(8).toString('hex'),
      url,
      secret: randomBytes(32).toString('hex'),
      events,
      active: true,
      createdAt: new Date().toISOString(),
    };

    const subs = await this.getSubscriptions();
    subs.push(sub);
    await this.saveSubscriptions(subs);

    log.info('Webhook subscription created', { id: sub.id, url, events });
    return sub;
  }

  /**
   * Remove a webhook subscription.
   */
  async unsubscribe(subscriptionId: string): Promise<boolean> {
    const subs = await this.getSubscriptions();
    const filtered = subs.filter((s) => s.id !== subscriptionId);

    if (filtered.length === subs.length) return false;

    await this.saveSubscriptions(filtered);
    log.info('Webhook subscription removed', { id: subscriptionId });
    return true;
  }

  /**
   * Get all subscriptions.
   */
  async getSubscriptions(): Promise<WebhookSubscription[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(SUBS_KEY);
      if (!raw) return [];
      return JSON.parse(raw) as WebhookSubscription[];
    } catch {
      return [];
    }
  }

  /**
   * Dispatch an event to all matching subscriptions.
   * Fire-and-forget — never throws.
   */
  async dispatch(type: WebhookEventType, data: Record<string, unknown>): Promise<void> {
    const event: WebhookEvent = {
      id: randomBytes(8).toString('hex'),
      type,
      timestamp: new Date().toISOString(),
      data,
    };

    try {
      const subs = await this.getSubscriptions();
      const matching = subs.filter((s) => s.active && s.events.includes(type));

      for (const sub of matching) {
        this.deliver(sub, event).catch((err: Error) => {
          log.warn('Webhook delivery failed', { subId: sub.id, eventId: event.id, error: err.message });
        });
      }

      await this.logEvent(event, matching.length);
    } catch (err) {
      log.warn('Webhook dispatch failed', { type, error: (err as Error).message });
    }
  }

  /**
   * Get recent webhook event log.
   */
  async getEventLog(limit = 20): Promise<WebhookEvent[]> {
    try {
      const redis = getRedis();
      const entries = await redis.lRange(`${LOG_PREFIX}all`, 0, limit - 1);
      return entries.map((e: string) => JSON.parse(e) as WebhookEvent);
    } catch {
      return [];
    }
  }

  /**
   * Deliver event to a subscription endpoint with HMAC signature.
   */
  private async deliver(sub: WebhookSubscription, event: WebhookEvent): Promise<void> {
    const payload = JSON.stringify(event);
    const signature = createHmac('sha256', sub.secret).update(payload).digest('hex');

    const response = await fetch(sub.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-WhatPay-Signature': `sha256=${signature}`,
        'X-WhatPay-Event': event.type,
        'X-WhatPay-Delivery': event.id,
      },
      body: payload,
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    log.info('Webhook delivered', { subId: sub.id, eventId: event.id, status: response.status });
  }

  private async saveSubscriptions(subs: WebhookSubscription[]): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(SUBS_KEY, JSON.stringify(subs));
    } catch (err) {
      log.warn('Failed to save subscriptions', { error: (err as Error).message });
    }
  }

  private async logEvent(event: WebhookEvent, subscriberCount: number): Promise<void> {
    try {
      const redis = getRedis();
      const entry = JSON.stringify({ ...event, subscriberCount });
      await redis.lPush(`${LOG_PREFIX}all`, entry);
      await redis.lTrim(`${LOG_PREFIX}all`, 0, MAX_LOG_ENTRIES - 1);
      await redis.expire(`${LOG_PREFIX}all`, LOG_TTL);
    } catch {
      // Fail silently
    }
  }
}

export const webhookEvents = new WebhookEventsService();
