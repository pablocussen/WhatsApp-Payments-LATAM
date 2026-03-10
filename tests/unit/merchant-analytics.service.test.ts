/**
 * Unit tests for MerchantAnalyticsService.
 * Redis is fully mocked.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test' },
}));

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  }),
}));

import { MerchantAnalyticsService } from '../../src/services/merchant-analytics.service';
import type { MerchantMetrics } from '../../src/services/merchant-analytics.service';

describe('MerchantAnalyticsService', () => {
  let svc: MerchantAnalyticsService;

  beforeEach(() => {
    svc = new MerchantAnalyticsService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
  });

  const validInput = {
    merchantId: 'm-1',
    period: 'daily' as const,
    periodKey: '2026-03-10',
    totalTransactions: 100,
    totalVolume: 5000000,
    totalFees: 150000,
    successRate: 95.5,
    uniqueCustomers: 80,
  };

  // ─── recordMetrics ──────────────────────────────────────

  describe('recordMetrics', () => {
    it('records metrics with computed avgTransactionSize', async () => {
      const m = await svc.recordMetrics(validInput);
      expect(m.merchantId).toBe('m-1');
      expect(m.period).toBe('daily');
      expect(m.avgTransactionSize).toBe(50000); // 5M / 100
      expect(m.refundCount).toBe(0);
      expect(m.chargebackCount).toBe(0);
    });

    it('handles zero transactions gracefully', async () => {
      const m = await svc.recordMetrics({ ...validInput, totalTransactions: 0, totalVolume: 0 });
      expect(m.avgTransactionSize).toBe(0);
    });

    it('accepts optional refund/chargeback counts', async () => {
      const m = await svc.recordMetrics({
        ...validInput, refundCount: 5, refundVolume: 25000, chargebackCount: 1,
      });
      expect(m.refundCount).toBe(5);
      expect(m.refundVolume).toBe(25000);
      expect(m.chargebackCount).toBe(1);
    });

    it('saves to Redis', async () => {
      await svc.recordMetrics(validInput);
      expect(mockRedisSet).toHaveBeenCalledWith(
        'analytics:metrics:m-1:daily:2026-03-10',
        expect.any(String),
        { EX: 90 * 24 * 60 * 60 },
      );
    });

    it('tracks period keys', async () => {
      await svc.recordMetrics(validInput);
      expect(mockRedisSet).toHaveBeenCalledWith(
        'analytics:periods:m-1:daily',
        expect.any(String),
        { EX: 90 * 24 * 60 * 60 },
      );
    });

    it('does not add duplicate period keys', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'analytics:periods:m-1:daily') return Promise.resolve(JSON.stringify(['2026-03-10']));
        return Promise.resolve(null);
      });

      await svc.recordMetrics(validInput);
      // Should not call set for periods since key already exists
      const periodsCalls = mockRedisSet.mock.calls.filter(
        (c: unknown[]) => (c[0] as string) === 'analytics:periods:m-1:daily',
      );
      expect(periodsCalls).toHaveLength(0);
    });

    it('rejects empty merchantId', async () => {
      await expect(svc.recordMetrics({ ...validInput, merchantId: '' }))
        .rejects.toThrow('merchantId');
    });

    it('rejects empty periodKey', async () => {
      await expect(svc.recordMetrics({ ...validInput, periodKey: '' }))
        .rejects.toThrow('periodKey');
    });

    it('rejects invalid period', async () => {
      await expect(svc.recordMetrics({ ...validInput, period: 'yearly' as any }))
        .rejects.toThrow('inválido');
    });

    it('rejects negative transactions', async () => {
      await expect(svc.recordMetrics({ ...validInput, totalTransactions: -1 }))
        .rejects.toThrow('negativo');
    });

    it('rejects negative volume', async () => {
      await expect(svc.recordMetrics({ ...validInput, totalVolume: -1 }))
        .rejects.toThrow('negativo');
    });

    it('rejects successRate out of range', async () => {
      await expect(svc.recordMetrics({ ...validInput, successRate: 101 }))
        .rejects.toThrow('0 y 100');
    });

    it('does not throw on Redis error', async () => {
      mockRedisSet.mockRejectedValue(new Error('Redis down'));
      const m = await svc.recordMetrics(validInput);
      expect(m.merchantId).toBe('m-1');
    });
  });

  // ─── getMetrics ─────────────────────────────────────────

  describe('getMetrics', () => {
    it('returns stored metrics', async () => {
      const metrics: MerchantMetrics = {
        merchantId: 'm-1', period: 'daily', periodKey: '2026-03-10',
        totalTransactions: 50, totalVolume: 2500000, totalFees: 75000,
        avgTransactionSize: 50000, successRate: 98, uniqueCustomers: 40,
        refundCount: 2, refundVolume: 10000, chargebackCount: 0,
        updatedAt: '2026-03-10T12:00:00Z',
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(metrics));
      const result = await svc.getMetrics('m-1', 'daily', '2026-03-10');
      expect(result).not.toBeNull();
      expect(result!.totalVolume).toBe(2500000);
    });

    it('returns null when not found', async () => {
      expect(await svc.getMetrics('m-1', 'daily', '2025-01-01')).toBeNull();
    });

    it('returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.getMetrics('m-1', 'daily', '2026-03-10')).toBeNull();
    });
  });

  // ─── getTrend ───────────────────────────────────────────

  describe('getTrend', () => {
    it('returns trend data', async () => {
      const m1: MerchantMetrics = {
        merchantId: 'm-1', period: 'daily', periodKey: '2026-03-08',
        totalTransactions: 30, totalVolume: 1500000, totalFees: 45000,
        avgTransactionSize: 50000, successRate: 95, uniqueCustomers: 25,
        refundCount: 0, refundVolume: 0, chargebackCount: 0, updatedAt: '2026-03-08',
      };
      const m2: MerchantMetrics = {
        merchantId: 'm-1', period: 'daily', periodKey: '2026-03-09',
        totalTransactions: 50, totalVolume: 2500000, totalFees: 75000,
        avgTransactionSize: 50000, successRate: 97, uniqueCustomers: 40,
        refundCount: 0, refundVolume: 0, chargebackCount: 0, updatedAt: '2026-03-09',
      };

      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'analytics:periods:m-1:daily') return Promise.resolve(JSON.stringify(['2026-03-08', '2026-03-09']));
        if (key === 'analytics:metrics:m-1:daily:2026-03-08') return Promise.resolve(JSON.stringify(m1));
        if (key === 'analytics:metrics:m-1:daily:2026-03-09') return Promise.resolve(JSON.stringify(m2));
        return Promise.resolve(null);
      });

      const trend = await svc.getTrend('m-1', 'daily', 'totalVolume');
      expect(trend).toHaveLength(2);
      expect(trend[0].periodKey).toBe('2026-03-08');
      expect(trend[0].value).toBe(1500000);
      expect(trend[1].value).toBe(2500000);
    });

    it('respects limit', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'analytics:periods:m-1:daily') {
          return Promise.resolve(JSON.stringify(['2026-03-01', '2026-03-02', '2026-03-03']));
        }
        if (key.startsWith('analytics:metrics:')) {
          return Promise.resolve(JSON.stringify({
            merchantId: 'm-1', period: 'daily', periodKey: 'x',
            totalTransactions: 10, totalVolume: 500000, totalFees: 15000,
            avgTransactionSize: 50000, successRate: 95, uniqueCustomers: 8,
            refundCount: 0, refundVolume: 0, chargebackCount: 0, updatedAt: '2026-03-01',
          }));
        }
        return Promise.resolve(null);
      });

      const trend = await svc.getTrend('m-1', 'daily', 'totalVolume', 2);
      expect(trend).toHaveLength(2);
    });

    it('returns empty when no periods', async () => {
      expect(await svc.getTrend('m-1', 'daily', 'totalVolume')).toEqual([]);
    });

    it('returns empty on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.getTrend('m-1', 'daily', 'totalVolume')).toEqual([]);
    });
  });

  // ─── getPerformance ─────────────────────────────────────

  describe('getPerformance', () => {
    it('calculates performance with growth', async () => {
      const current: MerchantMetrics = {
        merchantId: 'm-1', period: 'monthly', periodKey: '2026-03',
        totalTransactions: 200, totalVolume: 10000000, totalFees: 300000,
        avgTransactionSize: 50000, successRate: 97, uniqueCustomers: 150,
        refundCount: 3, refundVolume: 15000, chargebackCount: 0, updatedAt: '2026-03-10',
      };
      const previous: MerchantMetrics = {
        merchantId: 'm-1', period: 'monthly', periodKey: '2026-02',
        totalTransactions: 150, totalVolume: 7500000, totalFees: 225000,
        avgTransactionSize: 50000, successRate: 95, uniqueCustomers: 120,
        refundCount: 5, refundVolume: 25000, chargebackCount: 1, updatedAt: '2026-02-28',
      };

      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'analytics:metrics:m-1:monthly:2026-03') return Promise.resolve(JSON.stringify(current));
        if (key === 'analytics:metrics:m-1:monthly:2026-02') return Promise.resolve(JSON.stringify(previous));
        return Promise.resolve(null);
      });

      const perf = await svc.getPerformance('m-1', 'monthly', '2026-03', '2026-02');
      expect(perf.currentPeriod).not.toBeNull();
      expect(perf.previousPeriod).not.toBeNull();
      expect(perf.volumeChange).toBe(33);       // (10M - 7.5M) / 7.5M * 100 ≈ 33%
      expect(perf.transactionChange).toBe(33);   // (200 - 150) / 150 * 100 ≈ 33%
      expect(perf.feeChange).toBe(33);           // (300k - 225k) / 225k * 100 ≈ 33%
    });

    it('handles no current period data', async () => {
      const perf = await svc.getPerformance('m-1', 'monthly', '2026-04', '2026-03');
      expect(perf.currentPeriod).toBeNull();
      expect(perf.volumeChange).toBe(0);
    });

    it('handles no previous period (new merchant)', async () => {
      const current: MerchantMetrics = {
        merchantId: 'm-1', period: 'monthly', periodKey: '2026-03',
        totalTransactions: 100, totalVolume: 5000000, totalFees: 150000,
        avgTransactionSize: 50000, successRate: 95, uniqueCustomers: 80,
        refundCount: 0, refundVolume: 0, chargebackCount: 0, updatedAt: '2026-03-10',
      };

      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'analytics:metrics:m-1:monthly:2026-03') return Promise.resolve(JSON.stringify(current));
        return Promise.resolve(null);
      });

      const perf = await svc.getPerformance('m-1', 'monthly', '2026-03', '2026-02');
      expect(perf.previousPeriod).toBeNull();
      expect(perf.volumeChange).toBe(100); // 100% growth from 0
    });
  });

  // ─── rankMerchants ──────────────────────────────────────

  describe('rankMerchants', () => {
    it('ranks merchants by volume', async () => {
      const m1: MerchantMetrics = {
        merchantId: 'm-1', period: 'monthly', periodKey: '2026-03',
        totalTransactions: 200, totalVolume: 10000000, totalFees: 300000,
        avgTransactionSize: 50000, successRate: 97, uniqueCustomers: 150,
        refundCount: 0, refundVolume: 0, chargebackCount: 0, updatedAt: '2026-03-10',
      };
      const m2: MerchantMetrics = {
        merchantId: 'm-2', period: 'monthly', periodKey: '2026-03',
        totalTransactions: 500, totalVolume: 25000000, totalFees: 750000,
        avgTransactionSize: 50000, successRate: 99, uniqueCustomers: 400,
        refundCount: 0, refundVolume: 0, chargebackCount: 0, updatedAt: '2026-03-10',
      };

      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'analytics:metrics:m-1:monthly:2026-03') return Promise.resolve(JSON.stringify(m1));
        if (key === 'analytics:metrics:m-2:monthly:2026-03') return Promise.resolve(JSON.stringify(m2));
        return Promise.resolve(null);
      });

      const rankings = await svc.rankMerchants(['m-1', 'm-2'], 'monthly', '2026-03', 'totalVolume');
      expect(rankings).toHaveLength(2);
      expect(rankings[0].merchantId).toBe('m-2'); // higher volume
      expect(rankings[0].rank).toBe(1);
      expect(rankings[1].merchantId).toBe('m-1');
      expect(rankings[1].rank).toBe(2);
    });

    it('ranks by success rate', async () => {
      const m1: MerchantMetrics = {
        merchantId: 'm-1', period: 'monthly', periodKey: '2026-03',
        totalTransactions: 200, totalVolume: 10000000, totalFees: 300000,
        avgTransactionSize: 50000, successRate: 99, uniqueCustomers: 150,
        refundCount: 0, refundVolume: 0, chargebackCount: 0, updatedAt: '2026-03-10',
      };
      const m2: MerchantMetrics = {
        merchantId: 'm-2', period: 'monthly', periodKey: '2026-03',
        totalTransactions: 500, totalVolume: 25000000, totalFees: 750000,
        avgTransactionSize: 50000, successRate: 85, uniqueCustomers: 400,
        refundCount: 0, refundVolume: 0, chargebackCount: 0, updatedAt: '2026-03-10',
      };

      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'analytics:metrics:m-1:monthly:2026-03') return Promise.resolve(JSON.stringify(m1));
        if (key === 'analytics:metrics:m-2:monthly:2026-03') return Promise.resolve(JSON.stringify(m2));
        return Promise.resolve(null);
      });

      const rankings = await svc.rankMerchants(['m-1', 'm-2'], 'monthly', '2026-03', 'successRate');
      expect(rankings[0].merchantId).toBe('m-1'); // higher success rate
    });

    it('excludes merchants with no data', async () => {
      const m1: MerchantMetrics = {
        merchantId: 'm-1', period: 'monthly', periodKey: '2026-03',
        totalTransactions: 100, totalVolume: 5000000, totalFees: 150000,
        avgTransactionSize: 50000, successRate: 95, uniqueCustomers: 80,
        refundCount: 0, refundVolume: 0, chargebackCount: 0, updatedAt: '2026-03-10',
      };

      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'analytics:metrics:m-1:monthly:2026-03') return Promise.resolve(JSON.stringify(m1));
        return Promise.resolve(null);
      });

      const rankings = await svc.rankMerchants(['m-1', 'm-missing'], 'monthly', '2026-03', 'totalVolume');
      expect(rankings).toHaveLength(1);
    });

    it('returns empty for empty merchant list', async () => {
      const rankings = await svc.rankMerchants([], 'monthly', '2026-03', 'totalVolume');
      expect(rankings).toEqual([]);
    });
  });

  // ─── aggregateMetrics ───────────────────────────────────

  describe('aggregateMetrics', () => {
    it('aggregates across merchants', async () => {
      const m1: MerchantMetrics = {
        merchantId: 'm-1', period: 'monthly', periodKey: '2026-03',
        totalTransactions: 100, totalVolume: 5000000, totalFees: 150000,
        avgTransactionSize: 50000, successRate: 96, uniqueCustomers: 80,
        refundCount: 2, refundVolume: 10000, chargebackCount: 0, updatedAt: '2026-03-10',
      };
      const m2: MerchantMetrics = {
        merchantId: 'm-2', period: 'monthly', periodKey: '2026-03',
        totalTransactions: 200, totalVolume: 10000000, totalFees: 300000,
        avgTransactionSize: 50000, successRate: 98, uniqueCustomers: 150,
        refundCount: 3, refundVolume: 15000, chargebackCount: 1, updatedAt: '2026-03-10',
      };

      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'analytics:metrics:m-1:monthly:2026-03') return Promise.resolve(JSON.stringify(m1));
        if (key === 'analytics:metrics:m-2:monthly:2026-03') return Promise.resolve(JSON.stringify(m2));
        return Promise.resolve(null);
      });

      const agg = await svc.aggregateMetrics(['m-1', 'm-2'], 'monthly', '2026-03');
      expect(agg.merchantCount).toBe(2);
      expect(agg.totalVolume).toBe(15000000);
      expect(agg.totalTransactions).toBe(300);
      expect(agg.totalFees).toBe(450000);
      expect(agg.avgSuccessRate).toBe(97); // (96+98)/2
      expect(agg.totalUniqueCustomers).toBe(230);
    });

    it('returns zeros for no data', async () => {
      const agg = await svc.aggregateMetrics(['m-none'], 'monthly', '2026-03');
      expect(agg.merchantCount).toBe(0);
      expect(agg.totalVolume).toBe(0);
    });
  });

  // ─── getPeriodKeys ──────────────────────────────────────

  describe('getPeriodKeys', () => {
    it('returns stored period keys', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(['2026-03-08', '2026-03-09', '2026-03-10']));
      const keys = await svc.getPeriodKeys('m-1', 'daily');
      expect(keys).toHaveLength(3);
    });

    it('returns empty when none', async () => {
      expect(await svc.getPeriodKeys('m-none', 'daily')).toEqual([]);
    });

    it('returns empty on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.getPeriodKeys('m-1', 'daily')).toEqual([]);
    });
  });
});
