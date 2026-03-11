import { z } from 'zod';
import { env } from '../config/environment';
import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('whatsapp');
const FETCH_TIMEOUT_MS = 10_000;
const RETRY_DELAYS = [1_000, 5_000, 30_000]; // 1s, 5s, 30s
const DLQ_KEY = 'whatsapp:dlq';

// ─── Types ──────────────────────────────────────────────

interface WhatsAppTextMessage {
  messaging_product: 'whatsapp';
  to: string;
  type: 'text';
  text: { body: string };
}

interface WhatsAppButtonMessage {
  messaging_product: 'whatsapp';
  to: string;
  type: 'interactive';
  interactive: {
    type: 'button';
    body: { text: string };
    action: {
      buttons: Array<{
        type: 'reply';
        reply: { id: string; title: string };
      }>;
    };
  };
}

interface WhatsAppListMessage {
  messaging_product: 'whatsapp';
  to: string;
  type: 'interactive';
  interactive: {
    type: 'list';
    body: { text: string };
    action: {
      button: string;
      sections: Array<{
        title: string;
        rows: Array<{
          id: string;
          title: string;
          description?: string;
        }>;
      }>;
    };
  };
}

interface IncomingMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'interactive' | 'button' | 'image' | 'audio' | 'video' | 'sticker' | 'location' | 'contacts' | 'document';
  text?: { body: string };
  interactive?: {
    type: string;
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description: string };
  };
}

// ─── WhatsApp Service ───────────────────────────────────

export class WhatsAppService {
  private readonly apiUrl: string;
  private readonly phoneNumberId: string;
  private readonly apiToken: string;

  constructor() {
    this.apiUrl = env.WHATSAPP_API_URL;
    this.phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
    this.apiToken = env.WHATSAPP_API_TOKEN;
  }

  /** Mark a message as read (blue ticks) — fire-and-forget */
  async markAsRead(messageId: string): Promise<void> {
    const url = `${this.apiUrl}/${this.phoneNumberId}/messages`;
    try {
      await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(3_000),
        headers: { Authorization: `Bearer ${this.apiToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }),
      });
    } catch { /* best-effort */ }
  }

  async sendTextMessage(to: string, body: string): Promise<void> {
    const message: WhatsAppTextMessage = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    };
    await this.sendMessage(message);
  }

  async sendButtonMessage(
    to: string,
    body: string,
    buttons: Array<{ id: string; title: string }>,
  ): Promise<void> {
    const message: WhatsAppButtonMessage = {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: body },
        action: {
          buttons: buttons.slice(0, 3).map((btn) => ({
            type: 'reply' as const,
            reply: { id: btn.id, title: btn.title },
          })),
        },
      },
    };
    await this.sendMessage(message);
  }

  async sendListMessage(
    to: string,
    body: string,
    buttonText: string,
    sections: Array<{
      title: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }>,
  ): Promise<void> {
    const message: WhatsAppListMessage = {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: body },
        action: {
          button: buttonText.slice(0, 20),
          sections: sections.slice(0, 10).map((s) => ({
            title: s.title.slice(0, 24),
            rows: s.rows.slice(0, 10).map((r) => ({
              id: r.id,
              title: r.title.slice(0, 24),
              ...(r.description ? { description: r.description.slice(0, 72) } : {}),
            })),
          })),
        },
      },
    };
    await this.sendMessage(message);
  }

  async sendPaymentConfirmation(
    to: string,
    amount: number,
    receiverName: string,
    reference: string,
  ): Promise<void> {
    const formattedAmount = new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      minimumFractionDigits: 0,
    }).format(amount);

    const body = [
      `Pago enviado exitosamente`,
      `────────────────────`,
      `${formattedAmount} -> ${receiverName}`,
      `Ref: ${reference}`,
      `Fecha: ${new Date().toLocaleString('es-CL')}`,
      `────────────────────`,
    ].join('\n');

    await this.sendTextMessage(to, body);
  }

  parseWebhookMessage(body: unknown): IncomingMessage | null {
    const webhookSchema = z.object({
      entry: z.array(
        z.object({
          changes: z.array(
            z.object({
              value: z.object({
                messages: z
                  .array(
                    z.object({
                      from: z.string(),
                      id: z.string(),
                      timestamp: z.string(),
                      type: z.enum(['text', 'interactive', 'button', 'image', 'audio', 'video', 'sticker', 'location', 'contacts', 'document']),
                      text: z.object({ body: z.string() }).optional(),
                      interactive: z
                        .object({
                          type: z.string(),
                          button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
                          list_reply: z
                            .object({
                              id: z.string(),
                              title: z.string(),
                              description: z.string(),
                            })
                            .optional(),
                        })
                        .optional(),
                    }),
                  )
                  .optional(),
              }),
            }),
          ),
        }),
      ),
    });

    const parsed = webhookSchema.safeParse(body);
    if (!parsed.success) return null;

    const message = parsed.data.entry[0]?.changes[0]?.value.messages?.[0];
    if (!message) return null;

    return message;
  }

  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN) {
      return challenge;
    }
    return null;
  }

  private async sendMessage(
    message: WhatsAppTextMessage | WhatsAppButtonMessage | WhatsAppListMessage,
  ): Promise<void> {
    const url = `${this.apiUrl}/${this.phoneNumberId}/messages`;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          headers: {
            Authorization: `Bearer ${this.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(message),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(`WhatsApp API error: ${JSON.stringify(error)}`);
        }

        return; // Success
      } catch (err) {
        lastError = err as Error;

        if (attempt < RETRY_DELAYS.length) {
          log.warn(`Message send failed, retrying in ${RETRY_DELAYS[attempt]}ms`, {
            attempt: attempt + 1,
            to: message.to,
            error: lastError.message,
          });
          await this.delay(RETRY_DELAYS[attempt]);
        }
      }
    }

    // All retries exhausted → push to dead letter queue
    await this.pushToDLQ(message, lastError!);
    throw lastError!;
  }

  private async pushToDLQ(
    message: WhatsAppTextMessage | WhatsAppButtonMessage | WhatsAppListMessage,
    error: Error,
  ): Promise<void> {
    try {
      const redis = getRedis();
      const entry = JSON.stringify({
        timestamp: new Date().toISOString(),
        to: message.to,
        type: message.type,
        payload: message,
        error: error.message,
        attempts: RETRY_DELAYS.length + 1,
      });
      await redis.rPush(DLQ_KEY, entry);
      log.error('Message pushed to DLQ after all retries failed', { to: message.to });
    } catch (dlqErr) {
      log.error('Failed to push to DLQ', { error: (dlqErr as Error).message });
    }
  }

  /** Exposed for testing — overridable delay */
  protected delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Read DLQ entries (for admin dashboard) */
  static async getDLQ(limit = 50): Promise<unknown[]> {
    try {
      const redis = getRedis();
      const items = await redis.lRange(DLQ_KEY, 0, limit - 1);
      return items.map((item: string) => JSON.parse(item));
    } catch {
      return [];
    }
  }

  /** Remove a specific DLQ entry by index and requeue for retry */
  static async retryDLQEntry(index: number): Promise<boolean> {
    try {
      const redis = getRedis();
      const item = await redis.lIndex(DLQ_KEY, index);
      if (!item) return false;
      // Mark as removed by setting to sentinel, then clean up
      await redis.lSet(DLQ_KEY, index, '__REMOVED__');
      await redis.lRem(DLQ_KEY, 1, '__REMOVED__');
      return true;
    } catch {
      return false;
    }
  }

  /** Clear all DLQ entries */
  static async clearDLQ(): Promise<number> {
    try {
      const redis = getRedis();
      const count = await redis.lLen(DLQ_KEY);
      await redis.del(DLQ_KEY);
      return count;
    } catch {
      return 0;
    }
  }
}
