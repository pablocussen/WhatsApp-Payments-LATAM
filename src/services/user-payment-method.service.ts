import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('payment-method');
const PM_PREFIX = 'paymthd:';
const PM_TTL = 365 * 24 * 60 * 60;

export type PaymentMethodType = 'WALLET' | 'BANK_ACCOUNT' | 'DEBIT_CARD' | 'CREDIT_CARD' | 'KHIPU';

export interface PaymentMethod {
  id: string;
  userId: string;
  type: PaymentMethodType;
  alias: string;
  last4: string | null;
  bankName: string | null;
  isDefault: boolean;
  active: boolean;
  addedAt: string;
}

export class UserPaymentMethodService {
  async addMethod(input: { userId: string; type: PaymentMethodType; alias: string; last4?: string; bankName?: string }): Promise<PaymentMethod> {
    if (!input.alias || input.alias.length > 50) throw new Error('Alias entre 1 y 50 caracteres.');

    const methods = await this.getMethods(input.userId);
    if (methods.length >= 5) throw new Error('Maximo 5 metodos de pago.');

    const method: PaymentMethod = {
      id: 'pm_' + Date.now().toString(36),
      userId: input.userId,
      type: input.type,
      alias: input.alias,
      last4: input.last4 ?? null,
      bankName: input.bankName ?? null,
      isDefault: methods.length === 0,
      active: true,
      addedAt: new Date().toISOString(),
    };

    methods.push(method);
    await this.save(input.userId, methods);
    log.info('Payment method added', { userId: input.userId, type: input.type });
    return method;
  }

  async getMethods(userId: string): Promise<PaymentMethod[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(PM_PREFIX + userId);
      return raw ? JSON.parse(raw) as PaymentMethod[] : [];
    } catch { return []; }
  }

  async getDefault(userId: string): Promise<PaymentMethod | null> {
    const methods = await this.getMethods(userId);
    return methods.find(m => m.isDefault && m.active) ?? null;
  }

  async setDefault(userId: string, methodId: string): Promise<boolean> {
    const methods = await this.getMethods(userId);
    const target = methods.find(m => m.id === methodId);
    if (!target) return false;
    methods.forEach(m => m.isDefault = false);
    target.isDefault = true;
    await this.save(userId, methods);
    return true;
  }

  async removeMethod(userId: string, methodId: string): Promise<boolean> {
    const methods = await this.getMethods(userId);
    const filtered = methods.filter(m => m.id !== methodId);
    if (filtered.length === methods.length) return false;
    if (filtered.length > 0 && !filtered.some(m => m.isDefault)) {
      filtered[0].isDefault = true;
    }
    await this.save(userId, filtered);
    return true;
  }

  private async save(userId: string, methods: PaymentMethod[]): Promise<void> {
    try { const redis = getRedis(); await redis.set(PM_PREFIX + userId, JSON.stringify(methods), { EX: PM_TTL }); }
    catch (err) { log.warn('Failed to save methods', { error: (err as Error).message }); }
  }
}

export const userPaymentMethod = new UserPaymentMethodService();
