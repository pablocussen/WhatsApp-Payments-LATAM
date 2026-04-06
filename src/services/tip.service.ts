import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('tip');

const TIP_PREFIX = 'tips:';
const TIP_TTL = 90 * 24 * 60 * 60; // 90 days

export interface TipCalculation {
  baseAmount: number;
  tipPercent: number;
  tipAmount: number;
  totalAmount: number;
  baseFormatted: string;
  tipFormatted: string;
  totalFormatted: string;
}

export interface TipRecord {
  id: string;
  transactionRef: string;
  senderId: string;
  receiverId: string;
  baseAmount: number;
  tipPercent: number;
  tipAmount: number;
  createdAt: string;
}

const SUGGESTED_TIPS = [5, 10, 15, 20]; // percent
const MAX_TIP_PERCENT = 50;

export class TipService {
  /**
   * Calculate tip for a given amount.
   */
  calculateTip(amount: number, tipPercent: number): TipCalculation {
    if (tipPercent < 0 || tipPercent > MAX_TIP_PERCENT) {
      throw new Error(`Propina debe ser entre 0% y ${MAX_TIP_PERCENT}%`);
    }
    if (amount <= 0) {
      throw new Error('Monto debe ser positivo');
    }

    const tipAmount = Math.round(amount * tipPercent / 100);
    const totalAmount = amount + tipAmount;

    return {
      baseAmount: amount,
      tipPercent,
      tipAmount,
      totalAmount,
      baseFormatted: formatCLP(amount),
      tipFormatted: formatCLP(tipAmount),
      totalFormatted: formatCLP(totalAmount),
    };
  }

  /**
   * Get suggested tip amounts for a given base amount.
   */
  getSuggestions(amount: number): Array<{ percent: number; tipAmount: number; total: number; totalFormatted: string }> {
    return SUGGESTED_TIPS.map((percent) => {
      const tipAmount = Math.round(amount * percent / 100);
      const total = amount + tipAmount;
      return { percent, tipAmount, total, totalFormatted: formatCLP(total) };
    });
  }

  /**
   * Record a tip for a transaction.
   */
  async recordTip(input: {
    transactionRef: string;
    senderId: string;
    receiverId: string;
    baseAmount: number;
    tipPercent: number;
  }): Promise<TipRecord> {
    const tipAmount = Math.round(input.baseAmount * input.tipPercent / 100);

    const record: TipRecord = {
      id: `tip_${Date.now().toString(36)}`,
      transactionRef: input.transactionRef,
      senderId: input.senderId,
      receiverId: input.receiverId,
      baseAmount: input.baseAmount,
      tipPercent: input.tipPercent,
      tipAmount,
      createdAt: new Date().toISOString(),
    };

    try {
      const redis = getRedis();
      await redis.set(`${TIP_PREFIX}${record.id}`, JSON.stringify(record), { EX: TIP_TTL });

      // Track total tips for receiver
      await redis.incrBy(`${TIP_PREFIX}total:${input.receiverId}`, tipAmount);
    } catch (err) {
      log.warn('Failed to record tip', { error: (err as Error).message });
    }

    return record;
  }

  /**
   * Get total tips received by a user/merchant.
   */
  async getTotalTipsReceived(userId: string): Promise<number> {
    try {
      const redis = getRedis();
      const val = await redis.get(`${TIP_PREFIX}total:${userId}`);
      return val ? parseInt(val, 10) : 0;
    } catch {
      return 0;
    }
  }
}

export const tips = new TipService();
