import { createLogger } from '../config/logger';
import { MerchantWebhookService, type WebhookEvent, type MerchantWebhook } from './merchant-webhook.service';
import { randomBytes } from 'crypto';

const log = createLogger('webhook-dispatch');

const DISPATCH_TIMEOUT_MS = 10_000;

export interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: Record<string, unknown>;
}

export class WebhookDispatchService {
  private webhookService = new MerchantWebhookService();

  /**
   * Fire-and-forget dispatch to all merchant webhooks subscribed to this event.
   * Never throws — failures are logged and tracked per-webhook.
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

      // Dispatch all webhooks concurrently — fire and forget
      await Promise.allSettled(
        webhooks.map((wh) => this.deliverToWebhook(wh, event, payloadStr)),
      );
    } catch (err) {
      log.error('Dispatch failed (non-critical)', {
        merchantId,
        event,
        error: (err as Error).message,
      });
    }
  }

  private async deliverToWebhook(
    webhook: MerchantWebhook,
    event: WebhookEvent,
    payloadStr: string,
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
        durationMs: Date.now() - start,
      });
    } catch (err) {
      responseBody = (err as Error).message;
      log.warn('Webhook delivery failed', {
        webhookId: webhook.id,
        event,
        error: responseBody,
        durationMs: Date.now() - start,
      });
    }

    // Record delivery (never throw)
    try {
      await this.webhookService.recordDelivery({
        webhookId: webhook.id,
        event,
        payload: payloadStr,
        responseStatus,
        responseBody,
        success,
        duration: Date.now() - start,
        attempt: 1,
      });
    } catch (err) {
      log.error('Failed to record delivery', { error: (err as Error).message });
    }
  }
}

export const webhookDispatch = new WebhookDispatchService();
