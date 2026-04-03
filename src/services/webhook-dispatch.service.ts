import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { MerchantWebhookService, type WebhookEvent, type MerchantWebhook } from './merchant-webhook.service';
import { randomBytes } from 'crypto';

const log = createLogger('webhook-dispatch');

const DISPATCH_TIMEOUT_MS = 10_000;
const MAX_RETRIES = 5;
const RETRY_DELAYS_MS = [0, 5_000, 30_000, 120_000, 600_000]; // 0s, 5s, 30s, 2m, 10m
const RETRY_QUEUE_KEY = 'webhook:retry:queue';
const RETRY_QUEUE_TTL = 24 * 60 * 60; // 24h

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface RetryEntry {
  webhookId: string;
  merchantId: string;
  event: WebhookEvent;
  payloadStr: string;
  attempt: number;
  nextRetryAt: number; // epoch ms
  createdAt: string;
}

export class WebhookDispatchService {
  private webhookService = new MerchantWebhookService();

  /**
   * Fire-and-forget dispatch to all merchant webhooks subscribed to this event.
   * Failed deliveries are queued for retry with exponential backoff.
   * Never throws.
   */
  async dispatch(merchantId: string, event: WebhookEvent, data: Record<string, unknown>): Promise<void> {
    try {
      const webhooks = await this.webhookService.getWebhooksForEvent(merchantId, event);
      if (webhooks.length === 0) return;

      const payload: WebhookPayload = {
        event,
        timestamp: new Date().toISOString(),
        data,
      };

      const payloadStr = JSON.stringify(payload);

      await Promise.allSettled(
        webhooks.map((wh) => this.deliverToWebhook(wh, event, payloadStr, 1)),
      );
    } catch (err) {
      log.error('Dispatch failed (non-critical)', {
        merchantId,
        event,
        error: (err as Error).message,
      });
    }
  }

  /**
   * Deliver to a single webhook. On failure, queue for retry.
   */
  private async deliverToWebhook(
    webhook: MerchantWebhook,
    event: WebhookEvent,
    payloadStr: string,
    attempt: number,
  ): Promise<void> {
    const deliveryId = `del_${randomBytes(8).toString('hex')}`;
    const signature = this.webhookService.signPayload(payloadStr, webhook.secret);
    const start = Date.now();

    let responseStatus: number | null = null;
    let responseBody: string | null = null;
    let success = false;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DISPATCH_TIMEOUT_MS);

      const res = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-WhatPay-Signature': `sha256=${signature}`,
          'X-WhatPay-Event': event,
          'X-WhatPay-Delivery': deliveryId,
          'X-WhatPay-Attempt': String(attempt),
          'User-Agent': 'WhatPay-Webhook/1.0',
        },
        body: payloadStr,
        signal: controller.signal,
      });

      clearTimeout(timeout);
      responseStatus = res.status;
      responseBody = await res.text().catch(() => null);
      success = res.status >= 200 && res.status < 300;

      log.info('Webhook delivered', {
        webhookId: webhook.id,
        event,
        status: res.status,
        success,
        attempt,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      responseBody = (err as Error).message;
      log.warn('Webhook delivery failed', {
        webhookId: webhook.id,
        event,
        error: responseBody,
        attempt,
        durationMs: Date.now() - start,
      });
    }

    // Record delivery
    try {
      await this.webhookService.recordDelivery({
        webhookId: webhook.id,
        event,
        payload: payloadStr,
        responseStatus,
        responseBody,
        success,
        duration: Date.now() - start,
        attempt,
      });
    } catch (err) {
      log.error('Failed to record delivery', { error: (err as Error).message });
    }

    // Queue retry on failure
    if (!success && attempt < MAX_RETRIES) {
      await this.queueRetry({
        webhookId: webhook.id,
        merchantId: webhook.merchantId,
        event,
        payloadStr,
        attempt: attempt + 1,
        nextRetryAt: Date.now() + (RETRY_DELAYS_MS[attempt] ?? 600_000),
        createdAt: new Date().toISOString(),
      });
    }
  }

  /**
   * Queue a failed delivery for retry.
   */
  private async queueRetry(entry: RetryEntry): Promise<void> {
    try {
      const redis = getRedis();
      await redis.zAdd(RETRY_QUEUE_KEY, {
        score: entry.nextRetryAt,
        value: JSON.stringify(entry),
      });
      log.info('Queued webhook retry', {
        webhookId: entry.webhookId,
        event: entry.event,
        attempt: entry.attempt,
        nextRetryAt: new Date(entry.nextRetryAt).toISOString(),
      });
    } catch (err) {
      log.error('Failed to queue retry', { error: (err as Error).message });
    }
  }

  /**
   * Process pending retries. Called by SchedulerService on a timer.
   * Picks up entries whose nextRetryAt <= now and re-delivers them.
   */
  async processRetries(): Promise<number> {
    let processed = 0;
    try {
      const redis = getRedis();
      const now = Date.now();

      // Get entries ready to retry (score <= now)
      const entries = await redis.zRangeByScore(RETRY_QUEUE_KEY, 0, now, { LIMIT: { offset: 0, count: 20 } });

      if (entries.length === 0) return 0;

      // Remove them from queue atomically
      await redis.zRemRangeByScore(RETRY_QUEUE_KEY, 0, now);

      for (const raw of entries) {
        try {
          const entry: RetryEntry = JSON.parse(raw);
          const webhook = await this.webhookService.getWebhook(entry.webhookId);

          if (!webhook || webhook.status === 'disabled') {
            log.info('Skipping retry — webhook disabled/deleted', { webhookId: entry.webhookId });
            continue;
          }

          await this.deliverToWebhook(webhook, entry.event, entry.payloadStr, entry.attempt);
          processed++;
        } catch (err) {
          log.error('Retry processing error', { error: (err as Error).message });
        }
      }

      if (processed > 0) {
        log.info('Processed webhook retries', { count: processed });
      }
    } catch (err) {
      log.error('processRetries failed', { error: (err as Error).message });
    }
    return processed;
  }

  /**
   * Get pending retry count (for monitoring).
   */
  async getPendingRetryCount(): Promise<number> {
    try {
      const redis = getRedis();
      return await redis.zCard(RETRY_QUEUE_KEY);
    } catch {
      return 0;
    }
  }
}

export const webhookDispatch = new WebhookDispatchService();
