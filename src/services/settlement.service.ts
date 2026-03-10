import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { randomBytes } from 'crypto';

const log = createLogger('settlement');

// ─── Types ──────────────────────────────────────────────

export type SettlementStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type SettlementFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';

export interface Settlement {
  id: string;
  merchantId: string;
  amount: number;
  fee: number;
  netAmount: number;
  transactionCount: number;
  periodStart: string;
  periodEnd: string;
  status: SettlementStatus;
  bankAccount: string | null;
  transferReference: string | null;
  createdAt: string;
  processedAt: string | null;
}

export interface MerchantSettlementConfig {
  merchantId: string;
  frequency: SettlementFrequency;
  minimumAmount: number;       // minimum CLP to trigger settlement
  bankName: string;
  accountNumber: string;
  accountType: 'corriente' | 'vista' | 'ahorro';
  holderName: string;
  holderRut: string;
  active: boolean;
}

const SETTLEMENT_PREFIX = 'settlement:';
const CONFIG_PREFIX = 'settlement:config:';
const MERCHANT_INDEX = 'settlement:merchant:';
const SETTLEMENT_TTL = 365 * 24 * 60 * 60;

// ─── Service ────────────────────────────────────────────

export class SettlementService {
  /**
   * Configure settlement for a merchant.
   */
  async setConfig(input: {
    merchantId: string;
    frequency: SettlementFrequency;
    minimumAmount?: number;
    bankName: string;
    accountNumber: string;
    accountType: 'corriente' | 'vista' | 'ahorro';
    holderName: string;
    holderRut: string;
  }): Promise<MerchantSettlementConfig> {
    if (!input.bankName || input.bankName.length > 100) {
      throw new Error('Nombre del banco inválido');
    }
    if (!input.accountNumber || input.accountNumber.length > 30) {
      throw new Error('Número de cuenta inválido');
    }
    if (!input.holderName || input.holderName.length > 100) {
      throw new Error('Nombre del titular inválido');
    }
    if (!input.holderRut || !/^\d{7,8}-[\dkK]$/.test(input.holderRut)) {
      throw new Error('RUT del titular inválido');
    }
    if (input.minimumAmount !== undefined && input.minimumAmount < 0) {
      throw new Error('Monto mínimo no puede ser negativo');
    }

    const config: MerchantSettlementConfig = {
      merchantId: input.merchantId,
      frequency: input.frequency,
      minimumAmount: input.minimumAmount ?? 10000,
      bankName: input.bankName,
      accountNumber: input.accountNumber,
      accountType: input.accountType,
      holderName: input.holderName,
      holderRut: input.holderRut,
      active: true,
    };

    try {
      const redis = getRedis();
      await redis.set(`${CONFIG_PREFIX}${input.merchantId}`, JSON.stringify(config), { EX: SETTLEMENT_TTL });
      log.info('Settlement config updated', { merchantId: input.merchantId, frequency: input.frequency });
    } catch (err) {
      log.warn('Failed to save settlement config', { error: (err as Error).message });
    }

    return config;
  }

  /**
   * Get settlement config for a merchant.
   */
  async getConfig(merchantId: string): Promise<MerchantSettlementConfig | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${CONFIG_PREFIX}${merchantId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * Create a new settlement.
   */
  async createSettlement(input: {
    merchantId: string;
    amount: number;
    fee: number;
    transactionCount: number;
    periodStart: string;
    periodEnd: string;
  }): Promise<Settlement> {
    if (input.amount <= 0) throw new Error('Monto debe ser positivo');
    if (input.fee < 0) throw new Error('Comisión no puede ser negativa');
    if (input.transactionCount < 0) throw new Error('Conteo de transacciones inválido');

    const config = await this.getConfig(input.merchantId);

    const settlement: Settlement = {
      id: `stl_${randomBytes(8).toString('hex')}`,
      merchantId: input.merchantId,
      amount: input.amount,
      fee: input.fee,
      netAmount: input.amount - input.fee,
      transactionCount: input.transactionCount,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: 'pending',
      bankAccount: config?.accountNumber ?? null,
      transferReference: null,
      createdAt: new Date().toISOString(),
      processedAt: null,
    };

    try {
      const redis = getRedis();
      await redis.set(`${SETTLEMENT_PREFIX}${settlement.id}`, JSON.stringify(settlement), { EX: SETTLEMENT_TTL });

      // Merchant index
      const idxKey = `${MERCHANT_INDEX}${input.merchantId}`;
      const idxRaw = await redis.get(idxKey);
      const idx: string[] = idxRaw ? JSON.parse(idxRaw) : [];
      idx.push(settlement.id);
      await redis.set(idxKey, JSON.stringify(idx), { EX: SETTLEMENT_TTL });

      log.info('Settlement created', { id: settlement.id, amount: settlement.amount, merchantId: input.merchantId });
    } catch (err) {
      log.warn('Failed to save settlement', { error: (err as Error).message });
    }

    return settlement;
  }

  /**
   * Get a settlement by ID.
   */
  async getSettlement(settlementId: string): Promise<Settlement | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${SETTLEMENT_PREFIX}${settlementId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * List settlements for a merchant.
   */
  async getMerchantSettlements(merchantId: string): Promise<Settlement[]> {
    try {
      const redis = getRedis();
      const idxRaw = await redis.get(`${MERCHANT_INDEX}${merchantId}`);
      if (!idxRaw) return [];

      const ids: string[] = JSON.parse(idxRaw);
      const settlements: Settlement[] = [];

      for (const id of ids) {
        const raw = await redis.get(`${SETTLEMENT_PREFIX}${id}`);
        if (raw) settlements.push(JSON.parse(raw));
      }

      return settlements;
    } catch {
      return [];
    }
  }

  /**
   * Process a settlement (mark as processing → completed/failed).
   */
  async processSettlement(
    settlementId: string,
    transferReference: string,
  ): Promise<Settlement | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${SETTLEMENT_PREFIX}${settlementId}`);
      if (!raw) return null;

      const settlement: Settlement = JSON.parse(raw);
      if (settlement.status !== 'pending') {
        throw new Error(`No se puede procesar settlement en estado ${settlement.status}`);
      }

      settlement.status = 'completed';
      settlement.transferReference = transferReference;
      settlement.processedAt = new Date().toISOString();

      await redis.set(`${SETTLEMENT_PREFIX}${settlementId}`, JSON.stringify(settlement), { EX: SETTLEMENT_TTL });
      log.info('Settlement processed', { id: settlementId, reference: transferReference });
      return settlement;
    } catch (err) {
      if ((err as Error).message.includes('No se puede')) throw err;
      log.warn('Failed to process settlement', { settlementId, error: (err as Error).message });
      return null;
    }
  }

  /**
   * Cancel a pending settlement.
   */
  async cancelSettlement(settlementId: string, reason: string): Promise<Settlement | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${SETTLEMENT_PREFIX}${settlementId}`);
      if (!raw) return null;

      const settlement: Settlement = JSON.parse(raw);
      if (settlement.status !== 'pending') {
        throw new Error(`No se puede cancelar settlement en estado ${settlement.status}`);
      }

      settlement.status = 'cancelled';
      settlement.processedAt = new Date().toISOString();

      await redis.set(`${SETTLEMENT_PREFIX}${settlementId}`, JSON.stringify(settlement), { EX: SETTLEMENT_TTL });
      log.info('Settlement cancelled', { id: settlementId, reason });
      return settlement;
    } catch (err) {
      if ((err as Error).message.includes('No se puede')) throw err;
      return null;
    }
  }

  /**
   * Get pending settlements summary.
   */
  async getPendingSummary(merchantId: string): Promise<{
    count: number;
    totalAmount: number;
    totalFees: number;
    totalNet: number;
  }> {
    const settlements = await this.getMerchantSettlements(merchantId);
    const pending = settlements.filter((s) => s.status === 'pending');
    return {
      count: pending.length,
      totalAmount: pending.reduce((sum, s) => sum + s.amount, 0),
      totalFees: pending.reduce((sum, s) => sum + s.fee, 0),
      totalNet: pending.reduce((sum, s) => sum + s.netAmount, 0),
    };
  }
}

export const settlement = new SettlementService();
