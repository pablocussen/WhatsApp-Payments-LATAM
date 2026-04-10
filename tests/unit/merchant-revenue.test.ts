/**
 * MerchantRevenueService — revenue reports + period comparison.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { MerchantRevenueService } from '../../src/services/merchant-revenue.service';
import type { RevenueReport } from '../../src/services/merchant-revenue.service';

describe('MerchantRevenueService', () => {
  let service: MerchantRevenueService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MerchantRevenueService();
    mockRedisGet.mockResolvedValue(null);
  });

  const sampleEntry = {
    date: '2026-04-10',
    transactionCount: 25,
    grossVolume: 500000,
    fees: 7500,
    netRevenue: 492500,
    refunds: 0,
    avgTicket: 20000,
  };

  // ── recordDay ─────────────────────────────────────

  it('saves daily revenue', async () => {
    await service.recordDay('m1', sampleEntry);
    expect(mockRedisSet).toHaveBeenCalled();
    const key = mockRedisSet.mock.calls[0][0];
    expect(key).toContain('m1');
    expect(key).toContain('2026-04-10');
  });

  // ── getDay ────────────────────────────────────────

  it('returns null for missing day', async () => {
    expect(await service.getDay('m1', '2026-04-10')).toBeNull();
  });

  it('returns stored day', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(sampleEntry));
    const entry = await service.getDay('m1', '2026-04-10');
    expect(entry?.transactionCount).toBe(25);
  });

  // ── generateReport ────────────────────────────────

  it('generates empty report', async () => {
    const report = await service.generateReport('m1', '2026-04-01', '2026-04-07');
    expect(report.entries).toEqual([]);
    expect(report.totals.transactionCount).toBe(0);
    expect(report.period).toBe('WEEK');
  });

  it('aggregates entries in report', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.includes('2026-04-01')) return Promise.resolve(JSON.stringify({ ...sampleEntry, date: '2026-04-01', transactionCount: 10, grossVolume: 200000, fees: 3000, netRevenue: 197000, refunds: 0, avgTicket: 20000 }));
      if (key.includes('2026-04-02')) return Promise.resolve(JSON.stringify({ ...sampleEntry, date: '2026-04-02', transactionCount: 15, grossVolume: 300000, fees: 4500, netRevenue: 295500, refunds: 5000, avgTicket: 20000 }));
      return Promise.resolve(null);
    });
    const report = await service.generateReport('m1', '2026-04-01', '2026-04-03');
    expect(report.entries).toHaveLength(2);
    expect(report.totals.transactionCount).toBe(25);
    expect(report.totals.grossVolume).toBe(500000);
    expect(report.totals.fees).toBe(7500);
    expect(report.totals.refunds).toBe(5000);
    expect(report.totals.avgTicket).toBe(20000);
  });

  it('sets period TODAY for single day', async () => {
    const report = await service.generateReport('m1', '2026-04-10', '2026-04-10');
    expect(report.period).toBe('TODAY');
  });

  it('sets period MONTH for 30 days', async () => {
    const report = await service.generateReport('m1', '2026-04-01', '2026-04-30');
    expect(report.period).toBe('MONTH');
  });

  // ── formatReportSummary ───────────────────────────

  it('formats report summary', async () => {
    const report = await service.generateReport('m1', '2026-04-01', '2026-04-01');
    report.totals = { transactionCount: 50, grossVolume: 1000000, fees: 15000, netRevenue: 985000, refunds: 10000, avgTicket: 20000 };
    const summary = service.formatReportSummary(report);
    expect(summary).toContain('$1.000.000');
    expect(summary).toContain('$985.000');
    expect(summary).toContain('$15.000');
    expect(summary).toContain('50');
  });

  // ── comparePeriods ────────────────────────────────

  it('calculates growth percentages', () => {
    const current = { totals: { transactionCount: 100, grossVolume: 2000000, netRevenue: 1950000, avgTicket: 20000, fees: 0, refunds: 0 } } as RevenueReport;
    const previous = { totals: { transactionCount: 80, grossVolume: 1500000, netRevenue: 1450000, avgTicket: 18750, fees: 0, refunds: 0 } } as RevenueReport;
    const growth = service.comparePeriods(current, previous);
    expect(growth.txGrowth).toBe(25);
    expect(growth.volumeGrowth).toBe(33);
    expect(growth.revenueGrowth).toBe(34);
  });

  it('handles zero previous period', () => {
    const current = { totals: { transactionCount: 50, grossVolume: 500000, netRevenue: 490000, avgTicket: 10000, fees: 0, refunds: 0 } } as RevenueReport;
    const previous = { totals: { transactionCount: 0, grossVolume: 0, netRevenue: 0, avgTicket: 0, fees: 0, refunds: 0 } } as RevenueReport;
    const growth = service.comparePeriods(current, previous);
    expect(growth.txGrowth).toBe(0);
    expect(growth.volumeGrowth).toBe(0);
  });
});
