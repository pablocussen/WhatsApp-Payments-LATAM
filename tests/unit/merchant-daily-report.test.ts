const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantDailyReportService } from '../../src/services/merchant-daily-report.service';

describe('MerchantDailyReportService', () => {
  let s: MerchantDailyReportService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantDailyReportService(); mockRedisGet.mockResolvedValue(null); });

  it('generates report', async () => {
    const r = await s.generateReport('m1', '2026-04-12', {
      totalSales: 500000, totalTransactions: 50, cashSales: 200000, digitalSales: 300000,
      refunds: 5000, topProducts: [{ name: 'Cafe', count: 30 }], peakHour: 14, uniqueCustomers: 35,
    });
    expect(r.avgTicket).toBe(10000);
    expect(r.topProducts).toHaveLength(1);
  });

  it('handles zero transactions', async () => {
    const r = await s.generateReport('m1', '2026-04-12', {
      totalSales: 0, totalTransactions: 0, cashSales: 0, digitalSales: 0,
      refunds: 0, topProducts: [], peakHour: 0, uniqueCustomers: 0,
    });
    expect(r.avgTicket).toBe(0);
  });

  it('limits top products to 5', async () => {
    const products = Array.from({ length: 10 }, (_, i) => ({ name: 'P' + i, count: i }));
    const r = await s.generateReport('m1', '2026-04-12', {
      totalSales: 100000, totalTransactions: 10, cashSales: 0, digitalSales: 100000,
      refunds: 0, topProducts: products, peakHour: 12, uniqueCustomers: 8,
    });
    expect(r.topProducts).toHaveLength(5);
  });

  it('returns null for missing', async () => {
    expect(await s.getReport('m1', '2026-04-12')).toBeNull();
  });

  it('returns stored report', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ merchantId: 'm1', totalSales: 100000 }));
    const r = await s.getReport('m1', '2026-04-12');
    expect(r?.totalSales).toBe(100000);
  });

  it('formats report', () => {
    const f = s.formatReport({
      merchantId: 'm1', date: '2026-04-12', totalSales: 500000, totalTransactions: 50,
      cashSales: 200000, digitalSales: 300000, refunds: 5000, avgTicket: 10000,
      topProducts: [], peakHour: 14, uniqueCustomers: 35, generatedAt: '',
    });
    expect(f).toContain('2026-04-12');
    expect(f).toContain('$500.000');
    expect(f).toContain('50');
    expect(f).toContain('60%');
  });
});
