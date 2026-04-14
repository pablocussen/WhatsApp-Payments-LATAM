const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantSalesForecastService } from '../../src/services/merchant-sales-forecast.service';

describe('MerchantSalesForecastService', () => {
  let s: MerchantSalesForecastService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantSalesForecastService(); mockRedisGet.mockResolvedValue(null); });

  it('adds daily sales', async () => {
    const store = await s.addDailySales('m1', { date: '2026-04-12', totalSales: 500000, transactionCount: 25 });
    expect(store.history).toHaveLength(1);
  });

  it('rejects negative sales', async () => {
    await expect(s.addDailySales('m1', { date: '2026-04-12', totalSales: -100, transactionCount: 0 })).rejects.toThrow('negativas');
  });

  it('rejects invalid date', async () => {
    await expect(s.addDailySales('m1', { date: 'bad', totalSales: 100, transactionCount: 1 })).rejects.toThrow('invalida');
  });

  it('replaces existing entry for same date', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ merchantId: 'm1', history: [
      { date: '2026-04-12', totalSales: 100, transactionCount: 1 },
    ], updatedAt: '' }));
    const store = await s.addDailySales('m1', { date: '2026-04-12', totalSales: 500, transactionCount: 5 });
    expect(store.history).toHaveLength(1);
    expect(store.history[0].totalSales).toBe(500);
  });

  it('rejects forecast with insufficient data', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ merchantId: 'm1', history: [
      { date: '2026-04-10', totalSales: 100, transactionCount: 1 },
    ], updatedAt: '' }));
    await expect(s.forecastNextDays('m1', 7)).rejects.toThrow('7 dias');
  });

  it('rejects forecast days out of range', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ merchantId: 'm1', history: Array.from({ length: 10 }, (_, i) => ({
      date: `2026-04-${String(i + 1).padStart(2, '0')}`, totalSales: 1000, transactionCount: 5,
    })), updatedAt: '' }));
    await expect(s.forecastNextDays('m1', 50)).rejects.toThrow('1 y 30');
  });

  it('forecasts next 3 days', async () => {
    const history = Array.from({ length: 14 }, (_, i) => ({
      date: `2026-04-${String(i + 1).padStart(2, '0')}`,
      totalSales: 100000 + i * 5000,
      transactionCount: 20 + i,
    }));
    mockRedisGet.mockResolvedValue(JSON.stringify({ merchantId: 'm1', history, updatedAt: '' }));
    const forecasts = await s.forecastNextDays('m1', 3);
    expect(forecasts).toHaveLength(3);
    expect(forecasts[0].predictedSales).toBeGreaterThan(0);
  });

  it('returns FLAT trend with insufficient history', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ merchantId: 'm1', history: [], updatedAt: '' }));
    expect(await s.getTrend('m1')).toBe('FLAT');
  });

  it('detects UP trend', async () => {
    const history = [
      ...Array.from({ length: 7 }, (_, i) => ({ date: `2026-03-${String(i + 1).padStart(2, '0')}`, totalSales: 100000, transactionCount: 10 })),
      ...Array.from({ length: 7 }, (_, i) => ({ date: `2026-04-${String(i + 1).padStart(2, '0')}`, totalSales: 150000, transactionCount: 15 })),
    ];
    mockRedisGet.mockResolvedValue(JSON.stringify({ merchantId: 'm1', history, updatedAt: '' }));
    expect(await s.getTrend('m1')).toBe('UP');
  });

  it('detects DOWN trend', async () => {
    const history = [
      ...Array.from({ length: 7 }, (_, i) => ({ date: `2026-03-${String(i + 1).padStart(2, '0')}`, totalSales: 150000, transactionCount: 15 })),
      ...Array.from({ length: 7 }, (_, i) => ({ date: `2026-04-${String(i + 1).padStart(2, '0')}`, totalSales: 100000, transactionCount: 10 })),
    ];
    mockRedisGet.mockResolvedValue(JSON.stringify({ merchantId: 'm1', history, updatedAt: '' }));
    expect(await s.getTrend('m1')).toBe('DOWN');
  });

  it('returns null best day for empty history', async () => {
    expect(await s.getBestDay('m1')).toBeNull();
  });

  it('finds best day of week', async () => {
    const history = [
      { date: '2026-04-05', totalSales: 500000, transactionCount: 50 },
      { date: '2026-04-12', totalSales: 600000, transactionCount: 60 },
      { date: '2026-04-06', totalSales: 100000, transactionCount: 10 },
    ];
    mockRedisGet.mockResolvedValue(JSON.stringify({ merchantId: 'm1', history, updatedAt: '' }));
    const best = await s.getBestDay('m1');
    expect(best?.dayOfWeek).toBe(0);
    expect(best?.avgSales).toBe(550000);
  });
});
