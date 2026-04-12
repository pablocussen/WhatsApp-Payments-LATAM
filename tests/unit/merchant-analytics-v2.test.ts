const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantAnalyticsV2Service } from '../../src/services/merchant-analytics-v2.service';

describe('MerchantAnalyticsV2Service', () => {
  let s: MerchantAnalyticsV2Service;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantAnalyticsV2Service(); mockRedisGet.mockResolvedValue(null); });

  it('records first hour', async () => {
    await s.recordHour('m1', '2026-04-11', 14, 10000);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[14].transactions).toBe(1);
    expect(saved[14].revenue).toBe(10000);
  });

  it('accumulates existing hour', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ 14: { hour: 14, transactions: 2, revenue: 15000 } }));
    await s.recordHour('m1', '2026-04-11', 14, 5000);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[14].transactions).toBe(3);
    expect(saved[14].revenue).toBe(20000);
  });

  it('rejects invalid hour', async () => {
    await expect(s.recordHour('m1', '2026-04-11', 25, 1000)).rejects.toThrow('invalida');
  });

  it('returns empty breakdown for no data', async () => {
    expect(await s.getHourlyBreakdown('m1', '2026-04-11')).toEqual([]);
  });

  it('returns sorted hourly breakdown', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      14: { hour: 14, transactions: 5, revenue: 50000 },
      9: { hour: 9, transactions: 3, revenue: 30000 },
      18: { hour: 18, transactions: 10, revenue: 100000 },
    }));
    const breakdown = await s.getHourlyBreakdown('m1', '2026-04-11');
    expect(breakdown).toHaveLength(3);
    expect(breakdown[0].hour).toBe(9);
    expect(breakdown[2].hour).toBe(18);
  });

  it('finds peak hour', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      9: { hour: 9, revenue: 30000, transactions: 3 },
      14: { hour: 14, revenue: 80000, transactions: 8 },
      18: { hour: 18, revenue: 50000, transactions: 5 },
    }));
    const peak = await s.getPeakHour('m1', '2026-04-11');
    expect(peak?.hour).toBe(14);
  });

  it('finds quiet hour', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      9: { hour: 9, revenue: 30000, transactions: 3 },
      14: { hour: 14, revenue: 80000, transactions: 8 },
    }));
    const quiet = await s.getQuietHour('m1', '2026-04-11');
    expect(quiet?.hour).toBe(9);
  });

  it('returns null peak for empty', async () => {
    expect(await s.getPeakHour('m1', '2026-04-11')).toBeNull();
  });

  it('formats hourly chart', () => {
    const chart = s.formatHourlyChart([
      { hour: 9, revenue: 30000, transactions: 3 },
      { hour: 14, revenue: 60000, transactions: 6 },
    ]);
    expect(chart).toContain('09:00');
    expect(chart).toContain('14:00');
    expect(chart).toContain('$30.000');
  });

  it('handles empty chart', () => {
    expect(s.formatHourlyChart([])).toContain('Sin datos');
  });
});
