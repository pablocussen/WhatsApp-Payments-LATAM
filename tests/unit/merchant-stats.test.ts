/**
 * MerchantStatsService — dashboard analytics for merchants.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisIncr = jest.fn().mockResolvedValue(1);
const mockRedisIncrBy = jest.fn().mockResolvedValue(1);
const mockRedisDel = jest.fn().mockResolvedValue(1);

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    incr: (...args: unknown[]) => mockRedisIncr(...args),
    incrBy: (...args: unknown[]) => mockRedisIncrBy(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { MerchantStatsService } from '../../src/services/merchant-stats.service';

describe('MerchantStatsService', () => {
  let service: MerchantStatsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MerchantStatsService();
    mockRedisGet.mockResolvedValue(null);
  });

  // ── getDashboardStats ─────────────────────────────

  it('returns dashboard stats structure', async () => {
    const stats = await service.getDashboardStats('merchant-1');
    expect(stats.overview).toBeDefined();
    expect(stats.today).toBeDefined();
    expect(stats.period).toBeDefined();
    expect(stats.topPaymentMethods).toBeDefined();
    expect(stats.revenueByDay).toBeDefined();
    expect(stats.revenueByDay).toHaveLength(7);
  });

  it('returns cached stats if available', async () => {
    const cached = { overview: { totalRevenue: 100000 } };
    mockRedisGet.mockResolvedValueOnce(JSON.stringify(cached));

    const stats = await service.getDashboardStats('merchant-1');
    expect(stats.overview.totalRevenue).toBe(100000);
    // Only 1 Redis get call (the cache check), no counter reads
    expect(mockRedisGet).toHaveBeenCalledTimes(1);
  });

  it('caches the result with 5 min TTL', async () => {
    await service.getDashboardStats('merchant-1');
    expect(mockRedisSet).toHaveBeenCalledWith(
      'mstats:merchant-1',
      expect.any(String),
      { EX: 300 },
    );
  });

  it('calculates average ticket correctly', async () => {
    // Mock total_revenue = 50000, total_tx = 5
    mockRedisGet.mockImplementation((key: string) => {
      if (key.includes('total_revenue')) return Promise.resolve('50000');
      if (key.includes('total_tx')) return Promise.resolve('5');
      return Promise.resolve(null);
    });

    const stats = await service.getDashboardStats('merchant-1');
    expect(stats.overview.averageTicket).toBe(10000);
    expect(stats.overview.averageTicketFormatted).toBe('$10.000');
  });

  it('handles zero transactions', async () => {
    const stats = await service.getDashboardStats('merchant-1');
    expect(stats.overview.averageTicket).toBe(0);
    expect(stats.overview.totalTransactions).toBe(0);
  });

  // ── recordTransaction ─────────────────────────────

  it('increments all counters on transaction', async () => {
    await service.recordTransaction('merchant-1', 15000);
    // Should increment: total_revenue(15000), total_tx(1), today_revenue(15000), today_tx(1), day:date:revenue(15000), day:date:tx(1)
    expect(mockRedisIncrBy).toHaveBeenCalledTimes(3); // revenue counters
    expect(mockRedisIncr).toHaveBeenCalledTimes(3);   // tx counters
  });

  it('invalidates cache after recording transaction', async () => {
    await service.recordTransaction('merchant-1', 5000);
    expect(mockRedisDel).toHaveBeenCalledWith('mstats:merchant-1');
  });

  // ── incrementCounter ──────────────────────────────

  it('increments by 1 by default', async () => {
    await service.incrementCounter('merchant-1', 'total_tx');
    expect(mockRedisIncr).toHaveBeenCalledWith('mstats:counter:merchant-1:total_tx');
  });

  it('increments by custom amount', async () => {
    await service.incrementCounter('merchant-1', 'total_revenue', 25000);
    expect(mockRedisIncrBy).toHaveBeenCalledWith('mstats:counter:merchant-1:total_revenue', 25000);
  });

  // ── revenueByDay ──────────────────────────────────

  it('returns 7 days of revenue data', async () => {
    const stats = await service.getDashboardStats('merchant-1');
    expect(stats.revenueByDay).toHaveLength(7);
    // Each day has date, revenue, transactions
    for (const day of stats.revenueByDay) {
      expect(day.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(typeof day.revenue).toBe('number');
      expect(typeof day.transactions).toBe('number');
    }
  });

  it('formats revenue correctly', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.includes('total_revenue')) return Promise.resolve('1500000');
      return Promise.resolve(null);
    });

    const stats = await service.getDashboardStats('merchant-1');
    expect(stats.overview.totalRevenueFormatted).toBe('$1.500.000');
  });
});
