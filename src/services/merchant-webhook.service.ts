import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { randomBytes, createHmac } from 'crypto';

const log = createLogger('merchant-webhook');

// ─── Types ──────────────────────────────────────────────

export type WebhookEvent =
  | 'payment.created'
  | 'payment.completed'
  | 'payment.failed'
  | 'refund.created'
  | 'refund.completed'
  | 'settlement.created'
  | 'settlement.completed'
  | 'kyc.approved'
  | 'kyc.rejected'
  | 'dispute.opened'
  | 'dispute.resolved';

export type WebhookStatus = 'active' | 'disabled' | 'failing';

export interface MerchantWebhook {
  id: string;
  merchantId: string;
  url: string;
  secret: string;             // HMAC signing secret
  events: WebhookEvent[];
  status: WebhookStatus;
  description: string | null;
  failureCount: number;
  lastDeliveryAt: string | null;
  lastFailureAt: string | null;
  lastFailureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: WebhookEvent;
  payload: string;             // JSON string
  responseStatus: number | null;
  responseBody: string | null;
  success: boolean;
  duration: number;            // ms
  attempt: number;
  deliveredAt: string;
}

const WEBHOOK_PREFIX = 'mwh:hook:';
const MERCHANT_HOOKS = 'mwh:merchant:';
const DELIVERY_PREFIX = 'mwh:delivery:';
const HOOK_DELIVERIES = 'mwh:hook-deliveries:';
const WEBHOOK_TTL = 365 * 24 * 60 * 60;
const DELIVERY_TTL = 30 * 24 * 60 * 60; // 30 days

const VALID_EVENTS: WebhookEvent[] = [
  'payment.created', 'payment.completed', 'payment.failed',
  'refund.created', 'refund.completed',
  'settlement.created', 'settlement.completed',
  'kyc.approved', 'kyc.rejected',
  'dispute.opened', 'dispute.resolved',
];

const MAX_FAILURE_COUNT = 10;  // Auto-disable after 10 consecutive failures

// ─── Service ────────────────────────────────────────────

export class MerchantWebhookService {
  /**
   * Register a new webhook for a merchant.
   */
  async registerWebhook(input: {
    merchantId: string;
    url: string;
    events: WebhookEvent[];
    description?: string;
  }): Promise<MerchantWebhook> {
    if (!input.merchantId) throw new Error('merchantId requerido');
    if (!input.url || !this.isValidUrl(input.url)) {
      throw new Error('URL inválida (debe ser HTTPS)');
    }
    if (!input.events || input.events.length === 0) {
      throw new Error('Debe especificar al menos un evento');
    }
    const invalidEvents = input.events.filter((e) => !VALID_EVENTS.includes(e));
    if (invalidEvents.length > 0) {
      throw new Error(`Eventos inválidos: ${invalidEvents.join(', ')}`);
    }

    const webhook: MerchantWebhook = {
      id: `wh_${randomBytes(8).toString('hex')}`,
      merchantId: input.merchantId,
      url: input.url,
      secret: `whsec_${randomBytes(24).toString('hex')}`,
      events: [...new Set(input.events)],  // deduplicate
      status: 'active',
      description: input.description ?? null,
      failureCount: 0,
      lastDeliveryAt: null,
      lastFailureAt: null,
      lastFailureReason: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    try {
      const redis = getRedis();
      await redis.set(`${WEBHOOK_PREFIX}${webhook.id}`, JSON.stringify(webhook), { EX: WEBHOOK_TTL });

      // Add to merchant's webhook list
      const listKey = `${MERCHANT_HOOKS}${input.merchantId}`;
      const listRaw = await redis.get(listKey);
      const list: string[] = listRaw ? JSON.parse(listRaw) : [];
      list.push(webhook.id);
      await redis.set(listKey, JSON.stringify(list), { EX: WEBHOOK_TTL });

      log.info('Webhook registered', { id: webhook.id, merchantId: input.merchantId, events: webhook.events.length });
    } catch (err) {
      log.warn('Failed to save webhook', { error: (err as Error).message });
    }

    return webhook;
  }

  /**
   * Get a webhook by ID.
   */
  async getWebhook(webhookId: string): Promise<MerchantWebhook | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${WEBHOOK_PREFIX}${webhookId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * Get all webhooks for a merchant.
   */
  async getMerchantWebhooks(merchantId: string): Promise<MerchantWebhook[]> {
    try {
      const redis = getRedis();
      const listRaw = await redis.get(`${MERCHANT_HOOKS}${merchantId}`);
      if (!listRaw) return [];

      const ids: string[] = JSON.parse(listRaw);
      const hooks: MerchantWebhook[] = [];

      for (const id of ids) {
        const raw = await redis.get(`${WEBHOOK_PREFIX}${id}`);
        if (raw) hooks.push(JSON.parse(raw));
      }

      return hooks;
    } catch {
      return [];
    }
  }

  /**
   * Update webhook configuration.
   */
  async updateWebhook(
    webhookId: string,
    updates: {
      url?: string;
      events?: WebhookEvent[];
      description?: string;
      status?: WebhookStatus;
    },
  ): Promise<MerchantWebhook | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${WEBHOOK_PREFIX}${webhookId}`);
      if (!raw) return null;

      const webhook: MerchantWebhook = JSON.parse(raw);

      if (updates.url !== undefined) {
        if (!this.isValidUrl(updates.url)) throw new Error('URL inválida (debe ser HTTPS)');
        webhook.url = updates.url;
      }
      if (updates.events !== undefined) {
        if (updates.events.length === 0) throw new Error('Debe especificar al menos un evento');
        const invalid = updates.events.filter((e) => !VALID_EVENTS.includes(e));
        if (invalid.length > 0) throw new Error(`Eventos inválidos: ${invalid.join(', ')}`);
        webhook.events = [...new Set(updates.events)];
      }
      if (updates.description !== undefined) {
        webhook.description = updates.description;
      }
      if (updates.status !== undefined) {
        webhook.status = updates.status;
        if (updates.status === 'active') webhook.failureCount = 0;
      }

      webhook.updatedAt = new Date().toISOString();

      await redis.set(`${WEBHOOK_PREFIX}${webhookId}`, JSON.stringify(webhook), { EX: WEBHOOK_TTL });
      log.info('Webhook updated', { id: webhookId });
      return webhook;
    } catch (err) {
      if ((err as Error).message.includes('inválid') || (err as Error).message.includes('Debe')) throw err;
      return null;
    }
  }

  /**
   * Rotate the signing secret for a webhook.
   */
  async rotateSecret(webhookId: string): Promise<{ newSecret: string } | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${WEBHOOK_PREFIX}${webhookId}`);
      if (!raw) return null;

      const webhook: MerchantWebhook = JSON.parse(raw);
      webhook.secret = `whsec_${randomBytes(24).toString('hex')}`;
      webhook.updatedAt = new Date().toISOString();

      await redis.set(`${WEBHOOK_PREFIX}${webhookId}`, JSON.stringify(webhook), { EX: WEBHOOK_TTL });
      log.info('Webhook secret rotated', { id: webhookId });
      return { newSecret: webhook.secret };
    } catch {
      return null;
    }
  }

  /**
   * Delete a webhook.
   */
  async deleteWebhook(webhookId: string): Promise<boolean> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${WEBHOOK_PREFIX}${webhookId}`);
      if (!raw) return false;

      const webhook: MerchantWebhook = JSON.parse(raw);
      webhook.status = 'disabled';
      webhook.updatedAt = new Date().toISOString();

      // Soft-delete: mark disabled
      await redis.set(`${WEBHOOK_PREFIX}${webhookId}`, JSON.stringify(webhook), { EX: WEBHOOK_TTL });
      log.info('Webhook deleted', { id: webhookId });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Record a delivery attempt.
   */
  async recordDelivery(input: {
    webhookId: string;
    event: WebhookEvent;
    payload: string;
    responseStatus: number | null;
    responseBody: string | null;
    success: boolean;
    duration: number;
    attempt: number;
  }): Promise<WebhookDelivery> {
    const delivery: WebhookDelivery = {
      id: `dlv_${randomBytes(8).toString('hex')}`,
      webhookId: input.webhookId,
      event: input.event,
      payload: input.payload,
      responseStatus: input.responseStatus,
      responseBody: input.responseBody,
      success: input.success,
      duration: input.duration,
      attempt: input.attempt,
      deliveredAt: new Date().toISOString(),
    };

    try {
      const redis = getRedis();
      await redis.set(`${DELIVERY_PREFIX}${delivery.id}`, JSON.stringify(delivery), { EX: DELIVERY_TTL });

      // Add to webhook's delivery list
      const listKey = `${HOOK_DELIVERIES}${input.webhookId}`;
      const listRaw = await redis.get(listKey);
      const list: string[] = listRaw ? JSON.parse(listRaw) : [];
      list.push(delivery.id);
      // Keep last 100 deliveries
      if (list.length > 100) list.splice(0, list.length - 100);
      await redis.set(listKey, JSON.stringify(list), { EX: DELIVERY_TTL });

      // Update webhook status based on delivery result
      await this.updateDeliveryStatus(input.webhookId, input.success, input.responseBody);
    } catch (err) {
      log.warn('Failed to record delivery', { error: (err as Error).message });
    }

    return delivery;
  }

  /**
   * Get recent deliveries for a webhook.
   */
  async getDeliveries(webhookId: string, limit = 20): Promise<WebhookDelivery[]> {
    try {
      const redis = getRedis();
      const listRaw = await redis.get(`${HOOK_DELIVERIES}${webhookId}`);
      if (!listRaw) return [];

      const ids: string[] = JSON.parse(listRaw);
      const recentIds = ids.slice(-limit);
      const deliveries: WebhookDelivery[] = [];

      for (const id of recentIds) {
        const raw = await redis.get(`${DELIVERY_PREFIX}${id}`);
        if (raw) deliveries.push(JSON.parse(raw));
      }

      return deliveries.reverse(); // newest first
    } catch {
      return [];
    }
  }

  /**
   * Sign a payload with a webhook secret.
   */
  signPayload(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  /**
   * Verify a signed payload.
   */
  verifySignature(payload: string, secret: string, signature: string): boolean {
    const expected = this.signPayload(payload, secret);
    if (expected.length !== signature.length) return false;
    // Constant-time comparison
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) {
      mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return mismatch === 0;
  }

  /**
   * Get webhooks subscribed to an event for a merchant.
   */
  async getWebhooksForEvent(merchantId: string, event: WebhookEvent): Promise<MerchantWebhook[]> {
    const hooks = await this.getMerchantWebhooks(merchantId);
    return hooks.filter((h) => h.status === 'active' && h.events.includes(event));
  }

  /**
   * Get delivery stats for a webhook.
   */
  async getDeliveryStats(webhookId: string): Promise<{
    total: number;
    successful: number;
    failed: number;
    avgDuration: number;
  }> {
    const deliveries = await this.getDeliveries(webhookId, 100);
    if (deliveries.length === 0) {
      return { total: 0, successful: 0, failed: 0, avgDuration: 0 };
    }

    const successful = deliveries.filter((d) => d.success).length;
    const totalDuration = deliveries.reduce((sum, d) => sum + d.duration, 0);

    return {
      total: deliveries.length,
      successful,
      failed: deliveries.length - successful,
      avgDuration: Math.round(totalDuration / deliveries.length),
    };
  }

  // ─── Helpers ────────────────────────────────────────────

  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  private async updateDeliveryStatus(
    webhookId: string,
    success: boolean,
    failureReason: string | null,
  ): Promise<void> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${WEBHOOK_PREFIX}${webhookId}`);
      if (!raw) return;

      const webhook: MerchantWebhook = JSON.parse(raw);
      webhook.lastDeliveryAt = new Date().toISOString();

      if (success) {
        webhook.failureCount = 0;
      } else {
        webhook.failureCount += 1;
        webhook.lastFailureAt = new Date().toISOString();
        webhook.lastFailureReason = failureReason ?? 'Unknown error';

        // Auto-disable after too many failures
        if (webhook.failureCount >= MAX_FAILURE_COUNT) {
          webhook.status = 'failing';
          log.warn('Webhook auto-disabled due to failures', { id: webhookId, failures: webhook.failureCount });
        }
      }

      await redis.set(`${WEBHOOK_PREFIX}${webhookId}`, JSON.stringify(webhook), { EX: WEBHOOK_TTL });
    } catch {
      // fire-and-forget
    }
  }
}

export const merchantWebhook = new MerchantWebhookService();
