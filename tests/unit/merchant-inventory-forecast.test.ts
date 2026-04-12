const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantInventoryForecastService } from '../../src/services/merchant-inventory-forecast.service';

describe('MerchantInventoryForecastService', () => {
  let s: MerchantInventoryForecastService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantInventoryForecastService(); mockRedisGet.mockResolvedValue(null); });

  it('generates forecast with LOW urgency', async () => {
    const f = await s.generateForecast('m1', 'p1', 500, 60);
    expect(f.avgDailySales).toBe(2);
    expect(f.daysUntilStockout).toBe(250);
    expect(f.urgency).toBe('LOW');
  });

  it('detects CRITICAL urgency', async () => {
    const f = await s.generateForecast('m1', 'p1', 5, 60);
    expect(f.urgency).toBe('CRITICAL');
  });

  it('detects HIGH urgency', async () => {
    const f = await s.generateForecast('m1', 'p1', 18, 60);
    expect(f.urgency).toBe('HIGH');
  });

  it('handles zero sales (no stockout)', async () => {
    const f = await s.generateForecast('m1', 'p1', 100, 0);
    expect(f.daysUntilStockout).toBe(9999);
    expect(f.urgency).toBe('LOW');
  });

  it('recommends reorder quantity', async () => {
    const f = await s.generateForecast('m1', 'p1', 50, 300, 7);
    expect(f.recommendedReorder).toBeGreaterThan(0);
  });

  it('returns null for missing', async () => {
    expect(await s.getForecast('m1', 'p1')).toBeNull();
  });

  it('returns stored forecast', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ productId: 'p1', urgency: 'HIGH' }));
    const f = await s.getForecast('m1', 'p1');
    expect(f?.urgency).toBe('HIGH');
  });
});
