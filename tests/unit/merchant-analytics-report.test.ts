const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantAnalyticsReportService } from '../../src/services/merchant-analytics-report.service';

describe('MerchantAnalyticsReportService', () => {
  let s: MerchantAnalyticsReportService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantAnalyticsReportService(); mockRedisGet.mockResolvedValue(null); });

  it('generates report', async () => {
    const r = await s.generateReport('m1', { revenue: 500000, transactions: 50, uniqueCustomers: 30, topProducts: [{ name: 'Cafe', revenue: 150000, count: 30 }], peakHour: 13, peakDay: 'Viernes', returnRate: 65, previousRevenue: 400000 });
    expect(r.avgTicket).toBe(10000); expect(r.growthVsPrevious).toBe(25); expect(r.churnRate).toBe(35); expect(r.topProducts).toHaveLength(1);
  });
  it('handles zero transactions', async () => {
    const r = await s.generateReport('m1', { revenue: 0, transactions: 0, uniqueCustomers: 0, topProducts: [], peakHour: 0, peakDay: '-', returnRate: 0, previousRevenue: 0 });
    expect(r.avgTicket).toBe(0); expect(r.growthVsPrevious).toBe(0);
  });
  it('returns null for missing', async () => { expect(await s.getReport('m1')).toBeNull(); });
  it('returns stored report', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ merchantId: 'm1', revenue: 500000 }));
    const r = await s.getReport('m1');
    expect(r?.revenue).toBe(500000);
  });
  it('formats summary with growth arrow', () => {
    const f = s.formatReportSummary({ period: '2026-04', revenue: 500000, transactions: 50, avgTicket: 10000, uniqueCustomers: 30, returnRate: 65, growthVsPrevious: 25, peakDay: 'Viernes', peakHour: 13, topProducts: [], churnRate: 35, merchantId: 'm1', generatedAt: '' });
    expect(f).toContain('$500.000'); expect(f).toContain('25%'); expect(f).toContain('Viernes');
  });
  it('shows down arrow for negative growth', () => {
    const f = s.formatReportSummary({ growthVsPrevious: -10 } as any);
    expect(f).toContain('↓');
  });
});
