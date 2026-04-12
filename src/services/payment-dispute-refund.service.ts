import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('dispute-refund');
const DR_PREFIX = 'drefund:';
const DR_TTL = 365 * 24 * 60 * 60;

export type RefundType = 'FULL' | 'PARTIAL';
export type RefundStatus = 'PENDING' | 'APPROVED' | 'PROCESSED' | 'REJECTED';

export interface DisputeRefund {
  id: string;
  disputeId: string;
  transactionRef: string;
  userId: string;
  merchantId: string;
  originalAmount: number;
  refundAmount: number;
  refundType: RefundType;
  reason: string;
  status: RefundStatus;
  approvedBy: string | null;
  processedAt: string | null;
  createdAt: string;
}

export class PaymentDisputeRefundService {
  async requestRefund(input: {
    disputeId: string; transactionRef: string; userId: string; merchantId: string;
    originalAmount: number; refundAmount: number; reason: string;
  }): Promise<DisputeRefund> {
    if (input.refundAmount <= 0) throw new Error('Monto debe ser positivo.');
    if (input.refundAmount > input.originalAmount) throw new Error('Reembolso no puede exceder el monto original.');
    if (!input.reason || input.reason.length < 10) throw new Error('Razon minimo 10 caracteres.');

    const refund: DisputeRefund = {
      id: `ref_${Date.now().toString(36)}`, disputeId: input.disputeId,
      transactionRef: input.transactionRef, userId: input.userId, merchantId: input.merchantId,
      originalAmount: input.originalAmount, refundAmount: input.refundAmount,
      refundType: input.refundAmount === input.originalAmount ? 'FULL' : 'PARTIAL',
      reason: input.reason, status: 'PENDING',
      approvedBy: null, processedAt: null, createdAt: new Date().toISOString(),
    };
    try { const redis = getRedis(); await redis.set(`${DR_PREFIX}${refund.id}`, JSON.stringify(refund), { EX: DR_TTL }); }
    catch (err) { log.warn('Failed to save refund', { error: (err as Error).message }); }
    log.info('Refund requested', { refundId: refund.id, amount: input.refundAmount });
    return refund;
  }

  async getRefund(refundId: string): Promise<DisputeRefund | null> {
    try { const redis = getRedis(); const raw = await redis.get(`${DR_PREFIX}${refundId}`); return raw ? JSON.parse(raw) as DisputeRefund : null; }
    catch { return null; }
  }

  async approveRefund(refundId: string, approvedBy: string): Promise<boolean> {
    const refund = await this.getRefund(refundId);
    if (!refund || refund.status !== 'PENDING') return false;
    refund.status = 'APPROVED'; refund.approvedBy = approvedBy;
    try { const redis = getRedis(); await redis.set(`${DR_PREFIX}${refundId}`, JSON.stringify(refund), { EX: DR_TTL }); }
    catch { return false; }
    return true;
  }

  async processRefund(refundId: string): Promise<boolean> {
    const refund = await this.getRefund(refundId);
    if (!refund || refund.status !== 'APPROVED') return false;
    refund.status = 'PROCESSED'; refund.processedAt = new Date().toISOString();
    try { const redis = getRedis(); await redis.set(`${DR_PREFIX}${refundId}`, JSON.stringify(refund), { EX: DR_TTL }); }
    catch { return false; }
    log.info('Refund processed', { refundId, amount: refund.refundAmount });
    return true;
  }

  async rejectRefund(refundId: string, approvedBy: string): Promise<boolean> {
    const refund = await this.getRefund(refundId);
    if (!refund || refund.status !== 'PENDING') return false;
    refund.status = 'REJECTED'; refund.approvedBy = approvedBy;
    try { const redis = getRedis(); await redis.set(`${DR_PREFIX}${refundId}`, JSON.stringify(refund), { EX: DR_TTL }); }
    catch { return false; }
    return true;
  }

  formatRefundSummary(r: DisputeRefund): string {
    return `${r.id} — ${r.refundType} — ${formatCLP(r.refundAmount)} de ${formatCLP(r.originalAmount)} — ${r.status}`;
  }
}

export const paymentDisputeRefund = new PaymentDisputeRefundService();
