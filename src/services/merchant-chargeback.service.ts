import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('chargeback');
const CB_PREFIX = 'chargeback:';
const CB_TTL = 365 * 24 * 60 * 60;

export type ChargebackStatus = 'NEW' | 'UNDER_REVIEW' | 'CONTESTED' | 'ACCEPTED' | 'REJECTED' | 'CLOSED';
export type ChargebackReason = 'FRAUD' | 'NOT_RECEIVED' | 'NOT_AS_DESCRIBED' | 'DUPLICATE' | 'OTHER';

export interface Chargeback {
  id: string;
  merchantId: string;
  transactionRef: string;
  amount: number;
  reason: ChargebackReason;
  customerClaim: string;
  status: ChargebackStatus;
  merchantResponse: string | null;
  evidence: string[];
  deadlineAt: string;
  resolvedAt: string | null;
  createdAt: string;
}

export class MerchantChargebackService {
  async createChargeback(input: {
    merchantId: string; transactionRef: string; amount: number;
    reason: ChargebackReason; customerClaim: string;
  }): Promise<Chargeback> {
    if (input.amount <= 0) throw new Error('Monto debe ser positivo.');
    if (!input.customerClaim || input.customerClaim.length < 20) throw new Error('Reclamo minimo 20 caracteres.');

    const cb: Chargeback = {
      id: `cb_${Date.now().toString(36)}`, merchantId: input.merchantId,
      transactionRef: input.transactionRef, amount: input.amount,
      reason: input.reason, customerClaim: input.customerClaim,
      status: 'NEW', merchantResponse: null, evidence: [],
      deadlineAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      resolvedAt: null, createdAt: new Date().toISOString(),
    };
    try { const redis = getRedis(); await redis.set(`${CB_PREFIX}${cb.id}`, JSON.stringify(cb), { EX: CB_TTL }); }
    catch (err) { log.warn('Failed to save chargeback', { error: (err as Error).message }); }
    log.info('Chargeback created', { chargebackId: cb.id, amount: input.amount });
    return cb;
  }

  async submitResponse(chargebackId: string, response: string, evidence: string[]): Promise<boolean> {
    const cb = await this.getChargeback(chargebackId);
    if (!cb || cb.status !== 'NEW') return false;
    if (new Date() > new Date(cb.deadlineAt)) return false;
    if (!response || response.length < 20) throw new Error('Respuesta minimo 20 caracteres.');
    if (evidence.length > 10) throw new Error('Maximo 10 evidencias.');

    cb.merchantResponse = response;
    cb.evidence = evidence;
    cb.status = 'CONTESTED';
    try { const redis = getRedis(); await redis.set(`${CB_PREFIX}${chargebackId}`, JSON.stringify(cb), { EX: CB_TTL }); }
    catch { return false; }
    return true;
  }

  async acceptChargeback(chargebackId: string): Promise<boolean> {
    const cb = await this.getChargeback(chargebackId);
    if (!cb || cb.status === 'CLOSED') return false;
    cb.status = 'ACCEPTED';
    cb.resolvedAt = new Date().toISOString();
    try { const redis = getRedis(); await redis.set(`${CB_PREFIX}${chargebackId}`, JSON.stringify(cb), { EX: CB_TTL }); }
    catch { return false; }
    return true;
  }

  async resolveInFavor(chargebackId: string, merchantWins: boolean): Promise<boolean> {
    const cb = await this.getChargeback(chargebackId);
    if (!cb || cb.status !== 'CONTESTED') return false;
    cb.status = merchantWins ? 'REJECTED' : 'ACCEPTED';
    cb.resolvedAt = new Date().toISOString();
    try { const redis = getRedis(); await redis.set(`${CB_PREFIX}${chargebackId}`, JSON.stringify(cb), { EX: CB_TTL }); }
    catch { return false; }
    return true;
  }

  async getChargeback(id: string): Promise<Chargeback | null> {
    try { const redis = getRedis(); const raw = await redis.get(`${CB_PREFIX}${id}`); return raw ? JSON.parse(raw) as Chargeback : null; }
    catch { return null; }
  }

  isPastDeadline(cb: Chargeback): boolean {
    return new Date() > new Date(cb.deadlineAt);
  }

  formatChargebackSummary(cb: Chargeback): string {
    return `${cb.id} — ${formatCLP(cb.amount)} — ${cb.reason} — ${cb.status}`;
  }
}

export const merchantChargeback = new MerchantChargebackService();
