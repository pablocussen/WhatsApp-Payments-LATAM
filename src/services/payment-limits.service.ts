import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('payment-limits');

const DAILY_PREFIX = 'limits:daily:';
const MONTHLY_PREFIX = 'limits:monthly:';

export type KycLevel = 'BASIC' | 'INTERMEDIATE' | 'FULL';

export interface LimitConfig {
  perTransaction: number;
  daily: number;
  monthly: number;
}

export interface LimitStatus {
  kycLevel: KycLevel;
  limits: LimitConfig;
  used: {
    daily: number;
    dailyFormatted: string;
    monthly: number;
    monthlyFormatted: string;
  };
  remaining: {
    daily: number;
    dailyFormatted: string;
    monthly: number;
    monthlyFormatted: string;
    perTransaction: number;
    perTransactionFormatted: string;
  };
  percentUsed: {
    daily: number;
    monthly: number;
  };
  nearLimit: boolean;
}

const LIMITS: Record<KycLevel, LimitConfig> = {
  BASIC:        { perTransaction:    50_000, daily:   200_000, monthly:    200_000 },
  INTERMEDIATE: { perTransaction:   500_000, daily: 2_000_000, monthly:  2_000_000 },
  FULL:         { perTransaction: 2_000_000, daily: 5_000_000, monthly: 50_000_000 },
};

export class PaymentLimitsService {
  /**
   * Get limits for a KYC level.
   */
  getLimits(kycLevel: KycLevel): LimitConfig {
    return LIMITS[kycLevel] ?? LIMITS.BASIC;
  }

  /**
   * Check if a transaction amount is within limits.
   */
  async checkTransaction(userId: string, kycLevel: KycLevel, amount: number): Promise<{
    allowed: boolean;
    reason?: string;
    limitsStatus: LimitStatus;
  }> {
    const limits = this.getLimits(kycLevel);
    const status = await this.getStatus(userId, kycLevel);

    // Per-transaction limit
    if (amount > limits.perTransaction) {
      return {
        allowed: false,
        reason: `Monto excede el límite por transacción (${formatCLP(limits.perTransaction)}) para nivel ${kycLevel}.`,
        limitsStatus: status,
      };
    }

    // Daily limit
    if (status.used.daily + amount > limits.daily) {
      return {
        allowed: false,
        reason: `Excederías tu límite diario (${formatCLP(limits.daily)}). Usado hoy: ${status.used.dailyFormatted}.`,
        limitsStatus: status,
      };
    }

    // Monthly limit
    if (status.used.monthly + amount > limits.monthly) {
      return {
        allowed: false,
        reason: `Excederías tu límite mensual (${formatCLP(limits.monthly)}). Usado este mes: ${status.used.monthlyFormatted}.`,
        limitsStatus: status,
      };
    }

    return { allowed: true, limitsStatus: status };
  }

  /**
   * Record a transaction against the user's limits.
   */
  async recordTransaction(userId: string, amount: number): Promise<void> {
    try {
      const redis = getRedis();
      const today = new Date().toISOString().slice(0, 10);
      const month = today.slice(0, 7);

      const dailyKey = `${DAILY_PREFIX}${userId}:${today}`;
      const monthlyKey = `${MONTHLY_PREFIX}${userId}:${month}`;

      await redis.incrBy(dailyKey, amount);
      await redis.expire(dailyKey, 86_400); // 24h

      await redis.incrBy(monthlyKey, amount);
      await redis.expire(monthlyKey, 32 * 86_400); // ~32 days
    } catch (err) {
      log.warn('Failed to record transaction limits', { userId, error: (err as Error).message });
    }
  }

  /**
   * Get current limit status for a user.
   */
  async getStatus(userId: string, kycLevel: KycLevel): Promise<LimitStatus> {
    const limits = this.getLimits(kycLevel);
    let dailyUsed = 0;
    let monthlyUsed = 0;

    try {
      const redis = getRedis();
      const today = new Date().toISOString().slice(0, 10);
      const month = today.slice(0, 7);

      const dailyRaw = await redis.get(`${DAILY_PREFIX}${userId}:${today}`);
      const monthlyRaw = await redis.get(`${MONTHLY_PREFIX}${userId}:${month}`);

      dailyUsed = dailyRaw ? parseInt(dailyRaw, 10) : 0;
      monthlyUsed = monthlyRaw ? parseInt(monthlyRaw, 10) : 0;
    } catch { /* default to 0 */ }

    const dailyRemaining = Math.max(0, limits.daily - dailyUsed);
    const monthlyRemaining = Math.max(0, limits.monthly - monthlyUsed);
    const perTxRemaining = Math.min(limits.perTransaction, dailyRemaining, monthlyRemaining);

    const dailyPct = limits.daily > 0 ? Math.round((dailyUsed / limits.daily) * 100) : 0;
    const monthlyPct = limits.monthly > 0 ? Math.round((monthlyUsed / limits.monthly) * 100) : 0;

    return {
      kycLevel,
      limits,
      used: {
        daily: dailyUsed,
        dailyFormatted: formatCLP(dailyUsed),
        monthly: monthlyUsed,
        monthlyFormatted: formatCLP(monthlyUsed),
      },
      remaining: {
        daily: dailyRemaining,
        dailyFormatted: formatCLP(dailyRemaining),
        monthly: monthlyRemaining,
        monthlyFormatted: formatCLP(monthlyRemaining),
        perTransaction: perTxRemaining,
        perTransactionFormatted: formatCLP(perTxRemaining),
      },
      percentUsed: { daily: dailyPct, monthly: monthlyPct },
      nearLimit: dailyPct >= 80 || monthlyPct >= 80,
    };
  }
}

export const paymentLimits = new PaymentLimitsService();
