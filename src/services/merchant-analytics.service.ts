import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-analytics');

// ─── Types ──────────────────────────────────────────────

export type MetricPeriod = 'daily' | 'weekly' | 'monthly';

export interface MerchantMetrics {
  merchantId: string;
  period: MetricPeriod;
  periodKey: string;         // e.g., "2026-03-10", "2026-W10", "2026-03"
  totalTransactions: number;
  totalVolume: number;       // CLP
  totalFees: number;
  avgTransactionSize: number;
  successRate: number;       // 0-100
  uniqueCustomers: number;
  refundCount: number;
  refundVolume: number;
  chargebackCount: number;
  updatedAt: string;
}

export interface MerchantRanking {
  merchantId: string;
  rank: number;
  value: number;
  metric: string;
}

export interface TrendPoint {
  periodKey: string;
  value: number;
}

export interface PerformanceSummary {
  currentPeriod: MerchantMetrics | null;
  previousPeriod: MerchantMetrics | null;
  volumeChange: number;       // percentage
  transactionChange: number;  // percentage
  feeChange: number;          // percentage
}

const METRICS_PREFIX = 'analytics:metrics:';
const MERCHANT_PERIODS = 'analytics:periods:';
const RANKING_PREFIX = 'analytics:ranking:';
const ANALYTICS_TTL = 90 * 24 * 60 * 60;  // 90 days

// ─── Service ────────────────────────────────────────────

export class MerchantAnalyticsService {
  /**
   * Record or update metrics for a merchant period.
   */
  async recordMetrics(input: {
    merchantId: string;
    period: MetricPeriod;
    periodKey: string;
    totalTransactions: number;
    totalVolume: number;
    totalFees: number;
    successRate: number;
    uniqueCustomers: number;
    refundCount?: number;
    refundVolume?: number;
    chargebackCount?: number;
  }): Promise<MerchantMetrics> {
    if (!input.merchantId) throw new Error('merchantId requerido');
    if (!input.periodKey) throw new Error('periodKey requerido');
    if (!['daily', 'weekly', 'monthly'].includes(input.period)) {
      throw new Error(`Periodo inválido: ${input.period}`);
    }
    if (input.totalTransactions < 0) throw new Error('Transacciones no puede ser negativo');
    if (input.totalVolume < 0) throw new Error('Volumen no puede ser negativo');
    if (input.successRate < 0 || input.successRate > 100) {
      throw new Error('Tasa de éxito debe estar entre 0 y 100');
    }

    const metrics: MerchantMetrics = {
      merchantId: input.merchantId,
      period: input.period,
      periodKey: input.periodKey,
      totalTransactions: input.totalTransactions,
      totalVolume: input.totalVolume,
      totalFees: input.totalFees,
      avgTransactionSize: input.totalTransactions > 0
        ? Math.round(input.totalVolume / input.totalTransactions)
        : 0,
      successRate: input.successRate,
      uniqueCustomers: input.uniqueCustomers,
      refundCount: input.refundCount ?? 0,
      refundVolume: input.refundVolume ?? 0,
      chargebackCount: input.chargebackCount ?? 0,
      updatedAt: new Date().toISOString(),
    };

    try {
      const redis = getRedis();
      const key = `${METRICS_PREFIX}${input.merchantId}:${input.period}:${input.periodKey}`;
      await redis.set(key, JSON.stringify(metrics), { EX: ANALYTICS_TTL });

      // Track period keys for merchant
      const periodsKey = `${MERCHANT_PERIODS}${input.merchantId}:${input.period}`;
      const periodsRaw = await redis.get(periodsKey);
      const periods: string[] = periodsRaw ? JSON.parse(periodsRaw) : [];
      if (!periods.includes(input.periodKey)) {
        periods.push(input.periodKey);
        periods.sort();
        // Keep last 365 periods
        if (periods.length > 365) periods.splice(0, periods.length - 365);
        await redis.set(periodsKey, JSON.stringify(periods), { EX: ANALYTICS_TTL });
      }

      log.info('Metrics recorded', { merchantId: input.merchantId, period: input.period, periodKey: input.periodKey });
    } catch (err) {
      log.warn('Failed to save metrics', { error: (err as Error).message });
    }

    return metrics;
  }

  /**
   * Get metrics for a specific merchant and period.
   */
  async getMetrics(
    merchantId: string,
    period: MetricPeriod,
    periodKey: string,
  ): Promise<MerchantMetrics | null> {
    try {
      const redis = getRedis();
      const key = `${METRICS_PREFIX}${merchantId}:${period}:${periodKey}`;
      const raw = await redis.get(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * Get trend data for a metric over time.
   */
  async getTrend(
    merchantId: string,
    period: MetricPeriod,
    metric: keyof Pick<MerchantMetrics, 'totalVolume' | 'totalTransactions' | 'totalFees' | 'avgTransactionSize' | 'successRate' | 'uniqueCustomers'>,
    limit = 12,
  ): Promise<TrendPoint[]> {
    try {
      const redis = getRedis();
      const periodsKey = `${MERCHANT_PERIODS}${merchantId}:${period}`;
      const periodsRaw = await redis.get(periodsKey);
      if (!periodsRaw) return [];

      const allPeriods: string[] = JSON.parse(periodsRaw);
      const recentPeriods = allPeriods.slice(-limit);

      const trend: TrendPoint[] = [];
      for (const pk of recentPeriods) {
        const key = `${METRICS_PREFIX}${merchantId}:${period}:${pk}`;
        const raw = await redis.get(key);
        if (raw) {
          const m: MerchantMetrics = JSON.parse(raw);
          trend.push({ periodKey: pk, value: m[metric] });
        }
      }

      return trend;
    } catch {
      return [];
    }
  }

  /**
   * Get performance summary comparing current vs previous period.
   */
  async getPerformance(
    merchantId: string,
    period: MetricPeriod,
    currentPeriodKey: string,
    previousPeriodKey: string,
  ): Promise<PerformanceSummary> {
    const current = await this.getMetrics(merchantId, period, currentPeriodKey);
    const previous = await this.getMetrics(merchantId, period, previousPeriodKey);

    const pctChange = (curr: number, prev: number): number => {
      if (prev === 0) return curr > 0 ? 100 : 0;
      return Math.round(((curr - prev) / prev) * 100);
    };

    return {
      currentPeriod: current,
      previousPeriod: previous,
      volumeChange: pctChange(current?.totalVolume ?? 0, previous?.totalVolume ?? 0),
      transactionChange: pctChange(current?.totalTransactions ?? 0, previous?.totalTransactions ?? 0),
      feeChange: pctChange(current?.totalFees ?? 0, previous?.totalFees ?? 0),
    };
  }

  /**
   * Rank merchants by a metric for a given period.
   */
  async rankMerchants(
    merchantIds: string[],
    period: MetricPeriod,
    periodKey: string,
    metric: keyof Pick<MerchantMetrics, 'totalVolume' | 'totalTransactions' | 'totalFees' | 'avgTransactionSize' | 'successRate'>,
  ): Promise<MerchantRanking[]> {
    const entries: { merchantId: string; value: number }[] = [];

    for (const mid of merchantIds) {
      const m = await this.getMetrics(mid, period, periodKey);
      if (m) entries.push({ merchantId: mid, value: m[metric] });
    }

    entries.sort((a, b) => b.value - a.value);

    const rankings: MerchantRanking[] = entries.map((e, idx) => ({
      merchantId: e.merchantId,
      rank: idx + 1,
      value: e.value,
      metric,
    }));

    // Cache rankings
    try {
      const redis = getRedis();
      const cacheKey = `${RANKING_PREFIX}${period}:${periodKey}:${metric}`;
      await redis.set(cacheKey, JSON.stringify(rankings), { EX: 3600 });
    } catch {
      // fire-and-forget
    }

    return rankings;
  }

  /**
   * Aggregate metrics across multiple merchants.
   */
  async aggregateMetrics(
    merchantIds: string[],
    period: MetricPeriod,
    periodKey: string,
  ): Promise<{
    merchantCount: number;
    totalVolume: number;
    totalTransactions: number;
    totalFees: number;
    avgSuccessRate: number;
    totalUniqueCustomers: number;
  }> {
    const metricsArr: MerchantMetrics[] = [];

    for (const mid of merchantIds) {
      const m = await this.getMetrics(mid, period, periodKey);
      if (m) metricsArr.push(m);
    }

    if (metricsArr.length === 0) {
      return {
        merchantCount: 0, totalVolume: 0, totalTransactions: 0,
        totalFees: 0, avgSuccessRate: 0, totalUniqueCustomers: 0,
      };
    }

    return {
      merchantCount: metricsArr.length,
      totalVolume: metricsArr.reduce((s, m) => s + m.totalVolume, 0),
      totalTransactions: metricsArr.reduce((s, m) => s + m.totalTransactions, 0),
      totalFees: metricsArr.reduce((s, m) => s + m.totalFees, 0),
      avgSuccessRate: Math.round(
        metricsArr.reduce((s, m) => s + m.successRate, 0) / metricsArr.length,
      ),
      totalUniqueCustomers: metricsArr.reduce((s, m) => s + m.uniqueCustomers, 0),
    };
  }

  /**
   * Get available period keys for a merchant.
   */
  async getPeriodKeys(merchantId: string, period: MetricPeriod): Promise<string[]> {
    try {
      const redis = getRedis();
      const periodsKey = `${MERCHANT_PERIODS}${merchantId}:${period}`;
      const raw = await redis.get(periodsKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }
}

export const merchantAnalytics = new MerchantAnalyticsService();
