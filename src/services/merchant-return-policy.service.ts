import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('return-policy');
const RP_PREFIX = 'retpolicy:';
const RP_TTL = 365 * 24 * 60 * 60;

export interface ReturnPolicy {
  merchantId: string;
  windowDays: number;
  requireReceipt: boolean;
  allowPartialReturns: boolean;
  excludedCategories: string[];
  restockingFee: number;
  updatedAt: string;
}

export class MerchantReturnPolicyService {
  async getPolicy(merchantId: string): Promise<ReturnPolicy> {
    try {
      const redis = getRedis();
      const raw = await redis.get(RP_PREFIX + merchantId);
      if (raw) return JSON.parse(raw) as ReturnPolicy;
    } catch { /* defaults */ }
    return {
      merchantId, windowDays: 30, requireReceipt: true,
      allowPartialReturns: true, excludedCategories: [],
      restockingFee: 0, updatedAt: new Date().toISOString(),
    };
  }

  async updatePolicy(merchantId: string, updates: Partial<Omit<ReturnPolicy, 'merchantId' | 'updatedAt'>>): Promise<ReturnPolicy> {
    const policy = await this.getPolicy(merchantId);
    if (updates.windowDays !== undefined) {
      if (updates.windowDays < 0 || updates.windowDays > 180) throw new Error('Ventana entre 0 y 180 dias.');
      policy.windowDays = updates.windowDays;
    }
    if (updates.restockingFee !== undefined) {
      if (updates.restockingFee < 0 || updates.restockingFee > 50) throw new Error('Restocking fee entre 0 y 50%.');
      policy.restockingFee = updates.restockingFee;
    }
    if (updates.requireReceipt !== undefined) policy.requireReceipt = updates.requireReceipt;
    if (updates.allowPartialReturns !== undefined) policy.allowPartialReturns = updates.allowPartialReturns;
    if (updates.excludedCategories !== undefined) policy.excludedCategories = updates.excludedCategories;
    policy.updatedAt = new Date().toISOString();
    try { const redis = getRedis(); await redis.set(RP_PREFIX + merchantId, JSON.stringify(policy), { EX: RP_TTL }); }
    catch (err) { log.warn('Failed to save return policy', { error: (err as Error).message }); }
    return policy;
  }

  canReturn(policy: ReturnPolicy, purchaseDate: string, category: string): { allowed: boolean; reason?: string } {
    const daysSince = Math.floor((Date.now() - new Date(purchaseDate).getTime()) / (24 * 60 * 60 * 1000));
    if (daysSince > policy.windowDays) return { allowed: false, reason: 'Fuera de la ventana de devolucion.' };
    if (policy.excludedCategories.includes(category)) return { allowed: false, reason: 'Categoria no retornable.' };
    return { allowed: true };
  }

  calculateRefund(policy: ReturnPolicy, originalAmount: number): number {
    const fee = Math.round(originalAmount * policy.restockingFee / 100);
    return originalAmount - fee;
  }
}

export const merchantReturnPolicy = new MerchantReturnPolicyService();
