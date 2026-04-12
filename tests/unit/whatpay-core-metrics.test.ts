const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { WhatPayCoreMetricsService } from '../../src/services/whatpay-core-metrics.service';

describe('WhatPayCoreMetricsService', () => {
  let s: WhatPayCoreMetricsService;
  beforeEach(() => { jest.clearAllMocks(); s = new WhatPayCoreMetricsService(); mockRedisGet.mockResolvedValue(null); });

  it('returns empty metrics by default', async () => {
    const m = await s.getMetrics();
    expect(m.totalUsers).toBe(0);
    expect(m.platformUptime).toBe(100);
  });

  it('returns stored metrics', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ totalUsers: 25000, mau: 18000, dau: 5000 }));
    const m = await s.getMetrics();
    expect(m.totalUsers).toBe(25000);
  });

  it('updates metrics with calculated avgTicket', async () => {
    const m = await s.updateMetrics({
      totalUsers: 1000, activeUsers30d: 800, totalMerchants: 50, activeMerchants30d: 40,
      totalTransactions: 5000, totalVolume: 50000000, mau: 800, dau: 200, mrr: 1500000,
      platformUptime: 99.95, avgResponseMs: 150,
    });
    expect(m.avgTicket).toBe(10000);
    expect(m.updatedAt).toBeDefined();
  });

  it('handles zero transactions in avg', async () => {
    const m = await s.updateMetrics({
      totalUsers: 0, activeUsers30d: 0, totalMerchants: 0, activeMerchants30d: 0,
      totalTransactions: 0, totalVolume: 0, mau: 0, dau: 0, mrr: 0,
      platformUptime: 100, avgResponseMs: 0,
    });
    expect(m.avgTicket).toBe(0);
  });

  it('increments users', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ totalUsers: 100, totalTransactions: 0, totalVolume: 0, mau: 0, dau: 0 }));
    await s.incrementUsers(5);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.totalUsers).toBe(105);
  });

  it('increments transactions', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ totalUsers: 0, totalTransactions: 10, totalVolume: 100000, mau: 0, dau: 0 }));
    await s.incrementTransactions(5, 50000);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.totalTransactions).toBe(15);
    expect(saved.totalVolume).toBe(150000);
  });

  it('formats dashboard', () => {
    const m = {
      totalUsers: 25000, mau: 18000, dau: 5000, totalMerchants: 200,
      activeMerchants30d: 150, totalTransactions: 100000, totalVolume: 1500000000,
      avgTicket: 15000, mrr: 5000000, platformUptime: 99.95, avgResponseMs: 120,
      activeUsers30d: 18000, updatedAt: '',
    };
    const f = s.formatDashboard(m);
    expect(f).toContain('25.000');
    expect(f).toContain('MAU: 18000');
    expect(f).toContain('$1.500.000.000');
    expect(f).toContain('99.95%');
  });

  it('calculates engagement excelente', () => {
    const e = s.calculateEngagement({ mau: 1000, dau: 600 } as any);
    expect(e.dauMauRatio).toBe(60);
    expect(e.stickiness).toBe('Excelente');
  });

  it('calculates engagement bueno', () => {
    const e = s.calculateEngagement({ mau: 1000, dau: 350 } as any);
    expect(e.stickiness).toBe('Bueno');
  });

  it('calculates engagement bajo', () => {
    const e = s.calculateEngagement({ mau: 1000, dau: 100 } as any);
    expect(e.stickiness).toBe('Bajo');
  });

  it('handles zero MAU', () => {
    const e = s.calculateEngagement({ mau: 0, dau: 0 } as any);
    expect(e.dauMauRatio).toBe(0);
  });
});
