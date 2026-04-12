import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('recurring-billing');
const RB_PREFIX = 'recbill:';
const RB_TTL = 365 * 24 * 60 * 60;

export type BillingFrequency = 'WEEKLY' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
export type SubscriptionStatus = 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'PAST_DUE';

export interface RecurringSubscription {
  id: string;
  merchantId: string;
  customerPhone: string;
  productName: string;
  amount: number;
  frequency: BillingFrequency;
  status: SubscriptionStatus;
  nextBillingDate: string;
  failedAttempts: number;
  startedAt: string;
  cancelledAt: string | null;
}

export class MerchantRecurringBillingService {
  async createSubscription(input: {
    merchantId: string; customerPhone: string; productName: string;
    amount: number; frequency: BillingFrequency;
  }): Promise<RecurringSubscription> {
    if (input.amount < 100) throw new Error('Monto minimo: $100.');
    if (!input.productName) throw new Error('Producto requerido.');

    const sub: RecurringSubscription = {
      id: 'rsub_' + Date.now().toString(36),
      merchantId: input.merchantId,
      customerPhone: input.customerPhone,
      productName: input.productName,
      amount: input.amount,
      frequency: input.frequency,
      status: 'ACTIVE',
      nextBillingDate: this.calcNextDate(input.frequency),
      failedAttempts: 0,
      startedAt: new Date().toISOString(),
      cancelledAt: null,
    };
    try { const redis = getRedis(); await redis.set(RB_PREFIX + sub.id, JSON.stringify(sub), { EX: RB_TTL }); }
    catch (err) { log.warn('Failed to save subscription', { error: (err as Error).message }); }
    return sub;
  }

  async chargeSubscription(subId: string, success: boolean): Promise<RecurringSubscription | null> {
    const sub = await this.getSubscription(subId);
    if (!sub || sub.status !== 'ACTIVE') return null;
    if (success) {
      sub.failedAttempts = 0;
      sub.nextBillingDate = this.calcNextDate(sub.frequency);
    } else {
      sub.failedAttempts++;
      if (sub.failedAttempts >= 3) sub.status = 'PAST_DUE';
    }
    try { const redis = getRedis(); await redis.set(RB_PREFIX + subId, JSON.stringify(sub), { EX: RB_TTL }); }
    catch { return null; }
    return sub;
  }

  async cancelSubscription(subId: string): Promise<boolean> {
    const sub = await this.getSubscription(subId);
    if (!sub || sub.status === 'CANCELLED') return false;
    sub.status = 'CANCELLED';
    sub.cancelledAt = new Date().toISOString();
    try { const redis = getRedis(); await redis.set(RB_PREFIX + subId, JSON.stringify(sub), { EX: RB_TTL }); }
    catch { return false; }
    return true;
  }

  async pauseSubscription(subId: string): Promise<boolean> {
    const sub = await this.getSubscription(subId);
    if (!sub || sub.status !== 'ACTIVE') return false;
    sub.status = 'PAUSED';
    try { const redis = getRedis(); await redis.set(RB_PREFIX + subId, JSON.stringify(sub), { EX: RB_TTL }); }
    catch { return false; }
    return true;
  }

  async getSubscription(id: string): Promise<RecurringSubscription | null> {
    try { const redis = getRedis(); const raw = await redis.get(RB_PREFIX + id); return raw ? JSON.parse(raw) as RecurringSubscription : null; }
    catch { return null; }
  }

  formatSubSummary(s: RecurringSubscription): string {
    return s.productName + ': ' + formatCLP(s.amount) + ' ' + s.frequency + ' — ' + s.status;
  }

  private calcNextDate(freq: BillingFrequency): string {
    const next = new Date();
    switch (freq) {
      case 'WEEKLY': next.setDate(next.getDate() + 7); break;
      case 'MONTHLY': next.setMonth(next.getMonth() + 1); break;
      case 'QUARTERLY': next.setMonth(next.getMonth() + 3); break;
      case 'YEARLY': next.setFullYear(next.getFullYear() + 1); break;
    }
    return next.toISOString();
  }
}

export const merchantRecurringBilling = new MerchantRecurringBillingService();
