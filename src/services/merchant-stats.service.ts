import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('merchant-stats');

const STATS_PREFIX = 'mstats:';
const STATS_TTL = 300; // 5 min cache

export interface MerchantDashboardStats {
  overview: {
    totalRevenue: number;
    totalRevenueFormatted: string;
    totalTransactions: number;
    averageTicket: number;
    averageTicketFormatted: string;
    activeLinks: number;
    totalRefunds: number;
  };
  today: {
    revenue: number;
    revenueFormatted: string;
    transactions: number;
  };
  period: {
    last7days: { revenue: number; transactions: number };
    last30days: { revenue: number; transactions: number };
  };
  topPaymentMethods: Array<{ method: string; count: number; percentage: number }>;
  revenueByDay: Array<{ date: string; revenue: number; transactions: number }>;
}

export class MerchantStatsService {
  /**
   * Get dashboard stats for a merchant.
   * Uses Redis cache with 5 min TTL.
   */
  async getDashboardStats(merchantId: string): Promise<MerchantDashboardStats> {
    const cacheKey = `${STATS_PREFIX}${merchantId}`;

    try {
      const redis = getRedis();
      const cached = await redis.get(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch { /* cache miss */ }

    // Build stats from Redis counters
    const stats = await this.buildStats(merchantId);

    // Cache result
    try {
      const redis = getRedis();
      await redis.set(cacheKey, JSON.stringify(stats), { EX: STATS_TTL });
    } catch { /* ignore */ }

    return stats;
  }

  private async buildStats(merchantId: string): Promise<MerchantDashboardStats> {
    const redis = getRedis();

    // Read counters (these would be incremented by TransactionService on each payment)
    const [totalRev, totalTx, todayRev, todayTx, activeLinks, totalRefunds] = await Promise.all([
      this.getCounter(redis, `${merchantId}:total_revenue`),
      this.getCounter(redis, `${merchantId}:total_tx`),
      this.getCounter(redis, `${merchantId}:today_revenue`),
      this.getCounter(redis, `${merchantId}:today_tx`),
      this.getCounter(redis, `${merchantId}:active_links`),
      this.getCounter(redis, `${merchantId}:total_refunds`),
    ]);

    const avgTicket = totalTx > 0 ? Math.round(totalRev / totalTx) : 0;

    // Revenue by day (last 7 days)
    const revenueByDay: Array<{ date: string; revenue: number; transactions: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateKey = d.toISOString().slice(0, 10);
      const dayRev = await this.getCounter(redis, `${merchantId}:day:${dateKey}:revenue`);
      const dayTx = await this.getCounter(redis, `${merchantId}:day:${dateKey}:tx`);
      revenueByDay.push({ date: dateKey, revenue: dayRev, transactions: dayTx });
    }

    // Aggregate 7d and 30d
    const last7Rev = revenueByDay.reduce((s, d) => s + d.revenue, 0);
    const last7Tx = revenueByDay.reduce((s, d) => s + d.transactions, 0);

    return {
      overview: {
        totalRevenue: totalRev,
        totalRevenueFormatted: formatCLP(totalRev),
        totalTransactions: totalTx,
        averageTicket: avgTicket,
        averageTicketFormatted: formatCLP(avgTicket),
        activeLinks,
        totalRefunds,
      },
      today: {
        revenue: todayRev,
        revenueFormatted: formatCLP(todayRev),
        transactions: todayTx,
      },
      period: {
        last7days: { revenue: last7Rev, transactions: last7Tx },
        last30days: { revenue: totalRev, transactions: totalTx }, // approximation
      },
      topPaymentMethods: [
        { method: 'WALLET', count: totalTx, percentage: 100 },
      ],
      revenueByDay,
    };
  }

  private async getCounter(redis: ReturnType<typeof getRedis>, key: string): Promise<number> {
    try {
      const val = await redis.get(`${STATS_PREFIX}counter:${key}`);
      return val ? parseInt(val, 10) : 0;
    } catch {
      return 0;
    }
  }

  /**
   * Increment a merchant counter (called after each transaction).
   */
  async incrementCounter(merchantId: string, field: string, amount = 1): Promise<void> {
    try {
      const redis = getRedis();
      const key = `${STATS_PREFIX}counter:${merchantId}:${field}`;
      if (amount === 1) {
        await redis.incr(key);
      } else {
        await redis.incrBy(key, amount);
      }
    } catch (err) {
      log.warn('Failed to increment counter', { merchantId, field, error: (err as Error).message });
    }
  }

  /**
   * Record a transaction for stats tracking.
   */
  async recordTransaction(merchantId: string, amount: number): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    await Promise.all([
      this.incrementCounter(merchantId, 'total_revenue', amount),
      this.incrementCounter(merchantId, 'total_tx'),
      this.incrementCounter(merchantId, 'today_revenue', amount),
      this.incrementCounter(merchantId, 'today_tx'),
      this.incrementCounter(merchantId, `day:${today}:revenue`, amount),
      this.incrementCounter(merchantId, `day:${today}:tx`),
    ]);

    // Invalidate cache
    try {
      const redis = getRedis();
      await redis.del(`${STATS_PREFIX}${merchantId}`);
    } catch { /* ignore */ }
  }
}

export const merchantStats = new MerchantStatsService();
