const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserSpendingForecastService } from '../../src/services/user-spending-forecast.service';

describe('UserSpendingForecastService', () => {
  let s: UserSpendingForecastService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserSpendingForecastService(); mockRedisGet.mockResolvedValue(null); });

  it('generates forecast', async () => {
    const f = await s.generateForecast('u1', 150000, 200000);
    expect(f.avgDailySpend).toBeGreaterThan(0);
    expect(f.projectedMonthEnd).toBeGreaterThan(0);
  });

  it('handles zero last month', async () => {
    const f = await s.generateForecast('u1', 100000, 0);
    expect(f.vsLastMonth).toBe(0);
  });

  it('returns null for missing', async () => {
    expect(await s.getForecast('u1')).toBeNull();
  });

  it('returns stored', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ userId: 'u1', projectedMonthEnd: 500000 }));
    const f = await s.getForecast('u1');
    expect(f?.projectedMonthEnd).toBe(500000);
  });

  it('formats forecast', () => {
    const f = s.formatForecast({
      userId: 'u1', currentMonthSpent: 150000, daysElapsed: 15,
      projectedMonthEnd: 300000, avgDailySpend: 10000,
      vsLastMonth: 20, confidence: 'HIGH', generatedAt: '',
    });
    expect(f).toContain('$300.000');
    expect(f).toContain('20%');
    expect(f).toContain('HIGH');
  });
});
