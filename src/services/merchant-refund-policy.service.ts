import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('refund-policy');
const RP_PREFIX = 'mrefpol:';
const RP_TTL = 365 * 24 * 60 * 60;

export interface RefundPolicy {
  merchantId: string;
  enabled: boolean;
  autoRefundMaxAmount: number;
  refundWindowHours: number;
  requireReason: boolean;
  allowPartial: boolean;
  maxRefundsPerDay: number;
  notifyOnRefund: boolean;
  updatedAt: string;
}

export class MerchantRefundPolicyService {
  async getPolicy(merchantId: string): Promise<RefundPolicy> {
    try { const redis = getRedis(); const raw = await redis.get(`${RP_PREFIX}${merchantId}`); if (raw) return JSON.parse(raw) as RefundPolicy; }
    catch { /* defaults */ }
    return { merchantId, enabled: true, autoRefundMaxAmount: 50000, refundWindowHours: 72, requireReason: true, allowPartial: true, maxRefundsPerDay: 10, notifyOnRefund: true, updatedAt: new Date().toISOString() };
  }

  async updatePolicy(merchantId: string, updates: Partial<Omit<RefundPolicy, 'merchantId' | 'updatedAt'>>): Promise<RefundPolicy> {
    const policy = await this.getPolicy(merchantId);
    if (updates.autoRefundMaxAmount !== undefined) {
      if (updates.autoRefundMaxAmount < 0) throw new Error('Monto debe ser positivo.');
      policy.autoRefundMaxAmount = updates.autoRefundMaxAmount;
    }
    if (updates.refundWindowHours !== undefined) {
      if (updates.refundWindowHours < 1 || updates.refundWindowHours > 720) throw new Error('Ventana entre 1 y 720 horas.');
      policy.refundWindowHours = updates.refundWindowHours;
    }
    if (updates.enabled !== undefined) policy.enabled = updates.enabled;
    if (updates.requireReason !== undefined) policy.requireReason = updates.requireReason;
    if (updates.allowPartial !== undefined) policy.allowPartial = updates.allowPartial;
    if (updates.maxRefundsPerDay !== undefined) policy.maxRefundsPerDay = updates.maxRefundsPerDay;
    if (updates.notifyOnRefund !== undefined) policy.notifyOnRefund = updates.notifyOnRefund;
    policy.updatedAt = new Date().toISOString();
    try { const redis = getRedis(); await redis.set(`${RP_PREFIX}${merchantId}`, JSON.stringify(policy), { EX: RP_TTL }); }
    catch (err) { log.warn('Failed to save refund policy', { error: (err as Error).message }); }
    return policy;
  }

  canAutoRefund(policy: RefundPolicy, amount: number, hoursElapsed: number): { allowed: boolean; reason?: string } {
    if (!policy.enabled) return { allowed: false, reason: 'Reembolsos deshabilitados.' };
    if (hoursElapsed > policy.refundWindowHours) return { allowed: false, reason: 'Fuera de la ventana de reembolso.' };
    if (amount > policy.autoRefundMaxAmount) return { allowed: false, reason: 'Monto excede el limite de auto-reembolso.' };
    return { allowed: true };
  }
}

export const merchantRefundPolicy = new MerchantRefundPolicyService();
