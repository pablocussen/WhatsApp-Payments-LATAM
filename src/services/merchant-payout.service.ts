import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('merchant-payout');

const PAYOUT_PREFIX = 'payout:';
const PAYOUT_QUEUE = 'payout:queue';
const PAYOUT_CONFIG_PREFIX = 'payout:config:';
const PAYOUT_TTL = 90 * 24 * 60 * 60; // 90 days

export type PayoutFrequency = 'DAILY' | 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
export type PayoutStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface PayoutConfig {
  merchantId: string;
  frequency: PayoutFrequency;
  bankName: string;
  accountType: 'CORRIENTE' | 'VISTA' | 'AHORRO';
  accountNumber: string;
  rut: string;
  holderName: string;
  minAmount: number;
  enabled: boolean;
  updatedAt: string;
}

export interface Payout {
  id: string;
  merchantId: string;
  amount: number;
  fee: number;
  netAmount: number;
  transactionCount: number;
  periodStart: string;
  periodEnd: string;
  status: PayoutStatus;
  bankRef: string | null;
  createdAt: string;
  processedAt: string | null;
  failureReason: string | null;
}

const PAYOUT_FEE_RATE = 0; // 0% — free payouts

export class MerchantPayoutService {
  /**
   * Configure payout settings for a merchant.
   */
  async setConfig(input: Omit<PayoutConfig, 'updatedAt'>): Promise<PayoutConfig> {
    if (!input.merchantId) throw new Error('merchantId requerido.');
    if (!input.bankName || !input.accountNumber || !input.rut || !input.holderName) {
      throw new Error('Datos bancarios incompletos.');
    }
    if (input.minAmount < 1000) {
      throw new Error('Monto minimo de payout debe ser al menos $1.000.');
    }

    const config: PayoutConfig = {
      ...input,
      updatedAt: new Date().toISOString(),
    };

    try {
      const redis = getRedis();
      await redis.set(
        `${PAYOUT_CONFIG_PREFIX}${input.merchantId}`,
        JSON.stringify(config),
        { EX: PAYOUT_TTL },
      );
    } catch (err) {
      log.warn('Failed to save payout config', { merchantId: input.merchantId, error: (err as Error).message });
    }

    log.info('Payout config updated', { merchantId: input.merchantId, frequency: input.frequency });
    return config;
  }

  /**
   * Get payout configuration for a merchant.
   */
  async getConfig(merchantId: string): Promise<PayoutConfig | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${PAYOUT_CONFIG_PREFIX}${merchantId}`);
      return raw ? JSON.parse(raw) as PayoutConfig : null;
    } catch {
      return null;
    }
  }

  /**
   * Create a pending payout for a merchant.
   */
  async createPayout(input: {
    merchantId: string;
    amount: number;
    transactionCount: number;
    periodStart: string;
    periodEnd: string;
  }): Promise<Payout> {
    if (input.amount < 1000) {
      throw new Error('Monto minimo de payout: $1.000.');
    }

    const fee = Math.round(input.amount * PAYOUT_FEE_RATE);
    const payout: Payout = {
      id: `po_${Date.now().toString(36)}`,
      merchantId: input.merchantId,
      amount: input.amount,
      fee,
      netAmount: input.amount - fee,
      transactionCount: input.transactionCount,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: 'PENDING',
      bankRef: null,
      createdAt: new Date().toISOString(),
      processedAt: null,
      failureReason: null,
    };

    try {
      const redis = getRedis();
      const multi = redis.multi();
      multi.set(`${PAYOUT_PREFIX}${payout.id}`, JSON.stringify(payout), { EX: PAYOUT_TTL });
      multi.lPush(`${PAYOUT_PREFIX}list:${input.merchantId}`, payout.id);
      multi.lPush(PAYOUT_QUEUE, payout.id);
      await multi.exec();
    } catch (err) {
      log.warn('Failed to save payout', { payoutId: payout.id, error: (err as Error).message });
    }

    log.info('Payout created', {
      payoutId: payout.id,
      merchantId: input.merchantId,
      amount: input.amount,
      net: payout.netAmount,
    });

    return payout;
  }

  /**
   * Get a specific payout.
   */
  async getPayout(payoutId: string): Promise<Payout | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${PAYOUT_PREFIX}${payoutId}`);
      return raw ? JSON.parse(raw) as Payout : null;
    } catch {
      return null;
    }
  }

  /**
   * List payouts for a merchant.
   */
  async getMerchantPayouts(merchantId: string, limit = 20): Promise<Payout[]> {
    try {
      const redis = getRedis();
      const ids = await redis.lRange(`${PAYOUT_PREFIX}list:${merchantId}`, 0, limit - 1);
      if (!ids.length) return [];

      const payouts: Payout[] = [];
      for (const id of ids) {
        const raw = await redis.get(`${PAYOUT_PREFIX}${id}`);
        if (raw) payouts.push(JSON.parse(raw));
      }
      return payouts;
    } catch {
      return [];
    }
  }

  /**
   * Mark a payout as processing.
   */
  async markProcessing(payoutId: string): Promise<boolean> {
    return this.updateStatus(payoutId, 'PROCESSING');
  }

  /**
   * Mark a payout as completed with bank reference.
   */
  async markCompleted(payoutId: string, bankRef: string): Promise<boolean> {
    const payout = await this.getPayout(payoutId);
    if (!payout) return false;

    payout.status = 'COMPLETED';
    payout.bankRef = bankRef;
    payout.processedAt = new Date().toISOString();

    try {
      const redis = getRedis();
      await redis.set(`${PAYOUT_PREFIX}${payoutId}`, JSON.stringify(payout), { EX: PAYOUT_TTL });
    } catch {
      return false;
    }

    log.info('Payout completed', { payoutId, bankRef, amount: payout.netAmount });
    return true;
  }

  /**
   * Mark a payout as failed.
   */
  async markFailed(payoutId: string, reason: string): Promise<boolean> {
    const payout = await this.getPayout(payoutId);
    if (!payout) return false;

    payout.status = 'FAILED';
    payout.failureReason = reason;

    try {
      const redis = getRedis();
      await redis.set(`${PAYOUT_PREFIX}${payoutId}`, JSON.stringify(payout), { EX: PAYOUT_TTL });
    } catch {
      return false;
    }

    log.warn('Payout failed', { payoutId, reason });
    return true;
  }

  /**
   * Get payout summary with formatted amounts.
   */
  getPayoutSummary(payout: Payout): string {
    const parts = [
      `Payout ${payout.id}`,
      formatCLP(payout.netAmount),
      `${payout.transactionCount} transacciones`,
      payout.status,
    ];
    if (payout.bankRef) parts.push(`Ref: ${payout.bankRef}`);
    return parts.join(' — ');
  }

  private async updateStatus(payoutId: string, status: PayoutStatus): Promise<boolean> {
    const payout = await this.getPayout(payoutId);
    if (!payout) return false;

    payout.status = status;
    if (status === 'PROCESSING') {
      payout.processedAt = new Date().toISOString();
    }

    try {
      const redis = getRedis();
      await redis.set(`${PAYOUT_PREFIX}${payoutId}`, JSON.stringify(payout), { EX: PAYOUT_TTL });
    } catch {
      return false;
    }

    return true;
  }
}

export const merchantPayouts = new MerchantPayoutService();
