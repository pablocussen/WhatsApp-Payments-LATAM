import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('payment-intent');
const PI_PREFIX = 'pintent:';
const PI_TTL = 15 * 60; // 15 minutes

export type IntentStatus = 'CREATED' | 'CONFIRMED' | 'EXPIRED' | 'CANCELLED' | 'COMPLETED';

export interface PaymentIntent {
  id: string;
  userId: string;
  recipientPhone: string;
  amount: number;
  description: string;
  status: IntentStatus;
  confirmationCode: string;
  createdAt: string;
  expiresAt: string;
  completedAt: string | null;
}

export class UserPaymentIntentService {
  async createIntent(input: { userId: string; recipientPhone: string; amount: number; description: string }): Promise<PaymentIntent> {
    if (input.amount < 100) throw new Error('Monto minimo: $100.');
    if (input.amount > 2000000) throw new Error('Monto maximo: $2.000.000.');

    const intent: PaymentIntent = {
      id: `pi_${Date.now().toString(36)}`,
      userId: input.userId,
      recipientPhone: input.recipientPhone,
      amount: input.amount,
      description: input.description,
      status: 'CREATED',
      confirmationCode: Math.floor(1000 + Math.random() * 9000).toString(),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      completedAt: null,
    };

    try {
      const redis = getRedis();
      await redis.set(`${PI_PREFIX}${intent.id}`, JSON.stringify(intent), { EX: PI_TTL });
    } catch (err) { log.warn('Failed to save intent', { error: (err as Error).message }); }
    log.info('Payment intent created', { intentId: intent.id, amount: input.amount });
    return intent;
  }

  async confirmIntent(intentId: string, code: string): Promise<{ success: boolean; error?: string; intent?: PaymentIntent }> {
    const intent = await this.getIntent(intentId);
    if (!intent) return { success: false, error: 'Intencion no encontrada.' };
    if (intent.status !== 'CREATED') return { success: false, error: `Estado invalido: ${intent.status}` };
    if (new Date() > new Date(intent.expiresAt)) {
      intent.status = 'EXPIRED';
      await this.save(intent);
      return { success: false, error: 'Intencion expirada.' };
    }
    if (intent.confirmationCode !== code) return { success: false, error: 'Codigo incorrecto.' };

    intent.status = 'CONFIRMED';
    await this.save(intent);
    return { success: true, intent };
  }

  async completeIntent(intentId: string): Promise<boolean> {
    const intent = await this.getIntent(intentId);
    if (!intent || intent.status !== 'CONFIRMED') return false;
    intent.status = 'COMPLETED';
    intent.completedAt = new Date().toISOString();
    await this.save(intent);
    return true;
  }

  async cancelIntent(intentId: string): Promise<boolean> {
    const intent = await this.getIntent(intentId);
    if (!intent || intent.status === 'COMPLETED') return false;
    intent.status = 'CANCELLED';
    await this.save(intent);
    return true;
  }

  async getIntent(intentId: string): Promise<PaymentIntent | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${PI_PREFIX}${intentId}`);
      return raw ? JSON.parse(raw) as PaymentIntent : null;
    } catch { return null; }
  }

  formatIntentSummary(i: PaymentIntent): string {
    return `${i.id} — ${formatCLP(i.amount)} a ${i.recipientPhone} — ${i.status}`;
  }

  private async save(intent: PaymentIntent): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${PI_PREFIX}${intent.id}`, JSON.stringify(intent), { EX: PI_TTL });
    } catch (err) { log.warn('Failed to save intent', { error: (err as Error).message }); }
  }
}

export const userPaymentIntent = new UserPaymentIntentService();
