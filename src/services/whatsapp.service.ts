import { env } from '../config/environment';

const FETCH_TIMEOUT_MS = 10_000;

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

interface IncomingMessage {
  from: string;
  id: string;
  timestamp: string;
  type: 'text' | 'interactive' | 'button';
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

  parseWebhookMessage(body: any): IncomingMessage | null {
    try {
      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const message = change?.value?.messages?.[0];

      if (!message) return null;

      return {
        from: message.from,
        id: message.id,
        timestamp: message.timestamp,
        type: message.type,
        text: message.text,
        interactive: message.interactive,
      };
    } catch {
      return null;
    }
  }

  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    if (mode === 'subscribe' && token === env.WHATSAPP_VERIFY_TOKEN) {
      return challenge;
    }
    return null;
  }

  private async sendMessage(message: WhatsAppTextMessage | WhatsAppButtonMessage): Promise<void> {
    const url = `${this.apiUrl}/${this.phoneNumberId}/messages`;

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
  }
}
