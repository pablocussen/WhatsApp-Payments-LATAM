const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantEndOfDayService } from '../../src/services/merchant-end-of-day.service';

describe('MerchantEndOfDayService', () => {
  let s: MerchantEndOfDayService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantEndOfDayService(); mockRedisGet.mockResolvedValue(null); });

  const base = {
    merchantId: 'm1',
    date: '2026-04-12',
    openingBalance: 50000,
    cashSales: 200000,
    digitalSales: 150000,
    transactionCount: 45,
    refunds: 10000,
    actualCash: 240000,
    closedBy: 'Pablo',
  };

  it('closes day with computed totals', async () => {
    const r = await s.close(base);
    expect(r.totalSales).toBe(350000);
    expect(r.netRevenue).toBe(340000);
    expect(r.expectedCash).toBe(240000);
    expect(r.variance).toBe(0);
  });

  it('computes positive variance', async () => {
    const r = await s.close({ ...base, actualCash: 245000 });
    expect(r.variance).toBe(5000);
  });

  it('computes negative variance', async () => {
    const r = await s.close({ ...base, actualCash: 235000 });
    expect(r.variance).toBe(-5000);
  });

  it('rejects negative sales', async () => {
    await expect(s.close({ ...base, cashSales: -100 })).rejects.toThrow('negativas');
  });

  it('rejects duplicate date', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ date: '2026-04-12' }]));
    await expect(s.close(base)).rejects.toThrow('Ya existe');
  });

  it('retrieves by date', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ date: '2026-04-12', id: 'eod_1' }, { date: '2026-04-11', id: 'eod_2' }]));
    const r = await s.getByDate('m1', '2026-04-12');
    expect(r?.id).toBe('eod_1');
  });

  it('returns variance history', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { date: '2026-04-10', variance: 500 },
      { date: '2026-04-11', variance: -200 },
      { date: '2026-04-12', variance: 0 },
    ]));
    const hist = await s.getVarianceHistory('m1', 2);
    expect(hist).toHaveLength(2);
    expect(hist[0].date).toBe('2026-04-11');
  });

  it('computes weekly totals', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { totalSales: 100000 }, { totalSales: 200000 }, { totalSales: 300000 },
    ]));
    const w = await s.getWeeklyTotals('m1');
    expect(w.totalSales).toBe(600000);
    expect(w.avgDaily).toBe(200000);
    expect(w.days).toBe(3);
  });

  it('handles empty weekly totals', async () => {
    const w = await s.getWeeklyTotals('m1');
    expect(w.totalSales).toBe(0);
    expect(w.avgDaily).toBe(0);
  });

  it('formats report', () => {
    const r = {
      id: 'eod_1', merchantId: 'm1', date: '2026-04-12',
      openingBalance: 50000, cashSales: 200000, digitalSales: 150000,
      totalSales: 350000, transactionCount: 45, refunds: 10000,
      netRevenue: 340000, expectedCash: 240000, actualCash: 240000,
      variance: 0, closedBy: 'Pablo', closedAt: '',
    };
    const f = s.formatReport(r);
    expect(f).toContain('Cuadrada');
    expect(f).toContain('350.000');
    expect(f).toContain('Pablo');
  });

  it('formats variance as faltante', () => {
    const f = s.formatReport({
      id: 'x', merchantId: 'm1', date: '2026-04-12',
      openingBalance: 0, cashSales: 0, digitalSales: 0, totalSales: 0,
      transactionCount: 0, refunds: 0, netRevenue: 0, expectedCash: 100000,
      actualCash: 95000, variance: -5000, closedBy: 'x', closedAt: '',
    });
    expect(f).toContain('Faltante');
    expect(f).toContain('5.000');
  });
});
