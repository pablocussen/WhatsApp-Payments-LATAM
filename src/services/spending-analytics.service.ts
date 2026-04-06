import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('spending-analytics');

const ANALYTICS_PREFIX = 'spend:';

export interface SpendingInsights {
  userId: string;
  period: string;
  totalSpent: number;
  totalSpentFormatted: string;
  totalReceived: number;
  totalReceivedFormatted: string;
  netFlow: number;
  netFlowFormatted: string;
  transactionCount: number;
  averageTransaction: number;
  averageTransactionFormatted: string;
  largestTransaction: number;
  largestTransactionFormatted: string;
  byDayOfWeek: Array<{ day: string; amount: number; count: number }>;
}

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado'];

export class SpendingAnalyticsService {
  /**
   * Record a spending event for analytics.
   */
  async recordSpend(userId: string, amount: number, type: 'sent' | 'received'): Promise<void> {
    try {
      const redis = getRedis();
      const today = new Date();
      const month = today.toISOString().slice(0, 7);
      const dayOfWeek = today.getDay(); // 0=Sun

      const prefix = `${ANALYTICS_PREFIX}${userId}:${month}`;

      if (type === 'sent') {
        await redis.incrBy(`${prefix}:spent`, amount);
        await redis.incr(`${prefix}:tx_count`);
      } else {
        await redis.incrBy(`${prefix}:received`, amount);
      }

      // Track by day of week
      await redis.incrBy(`${prefix}:dow:${dayOfWeek}:amount`, amount);
      await redis.incr(`${prefix}:dow:${dayOfWeek}:count`);

      // Track largest
      const currentLargest = await redis.get(`${prefix}:largest`);
      if (!currentLargest || amount > parseInt(currentLargest, 10)) {
        await redis.set(`${prefix}:largest`, String(amount));
      }

      // Set TTL (60 days)
      const keys = [
        `${prefix}:spent`, `${prefix}:received`, `${prefix}:tx_count`, `${prefix}:largest`,
        ...Array.from({ length: 7 }, (_, i) => [`${prefix}:dow:${i}:amount`, `${prefix}:dow:${i}:count`]).flat(),
      ];
      for (const key of keys) {
        await redis.expire(key, 60 * 86_400);
      }
    } catch (err) {
      log.warn('Failed to record spending', { userId, error: (err as Error).message });
    }
  }

  /**
   * Get spending insights for a user for a given month.
   */
  async getInsights(userId: string, month?: string): Promise<SpendingInsights> {
    const m = month ?? new Date().toISOString().slice(0, 7);
    const prefix = `${ANALYTICS_PREFIX}${userId}:${m}`;

    let totalSpent = 0, totalReceived = 0, txCount = 0, largest = 0;

    try {
      const redis = getRedis();
      totalSpent = parseInt(await redis.get(`${prefix}:spent`) ?? '0', 10);
      totalReceived = parseInt(await redis.get(`${prefix}:received`) ?? '0', 10);
      txCount = parseInt(await redis.get(`${prefix}:tx_count`) ?? '0', 10);
      largest = parseInt(await redis.get(`${prefix}:largest`) ?? '0', 10);
    } catch { /* defaults */ }

    const avg = txCount > 0 ? Math.round(totalSpent / txCount) : 0;
    const netFlow = totalReceived - totalSpent;

    // By day of week
    const byDayOfWeek = await Promise.all(
      DAYS.map(async (day, i) => {
        try {
          const redis = getRedis();
          const amount = parseInt(await redis.get(`${prefix}:dow:${i}:amount`) ?? '0', 10);
          const count = parseInt(await redis.get(`${prefix}:dow:${i}:count`) ?? '0', 10);
          return { day, amount, count };
        } catch {
          return { day, amount: 0, count: 0 };
        }
      }),
    );

    return {
      userId,
      period: m,
      totalSpent,
      totalSpentFormatted: formatCLP(totalSpent),
      totalReceived,
      totalReceivedFormatted: formatCLP(totalReceived),
      netFlow,
      netFlowFormatted: `${netFlow >= 0 ? '+' : ''}${formatCLP(Math.abs(netFlow))}`,
      transactionCount: txCount,
      averageTransaction: avg,
      averageTransactionFormatted: formatCLP(avg),
      largestTransaction: largest,
      largestTransactionFormatted: formatCLP(largest),
      byDayOfWeek,
    };
  }
}

export const spendingAnalytics = new SpendingAnalyticsService();
