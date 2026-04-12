const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantCampaignPerformanceService } from '../../src/services/merchant-campaign-performance.service';

describe('MerchantCampaignPerformanceService', () => {
  let s: MerchantCampaignPerformanceService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantCampaignPerformanceService(); mockRedisGet.mockResolvedValue(null); });

  it('tracks impression', async () => {
    await s.trackImpression('c1');
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.impressions).toBe(1);
  });

  it('tracks click', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ campaignId: 'c1', impressions: 10, clicks: 2, conversions: 0, revenue: 0, cost: 0, updatedAt: '' }));
    await s.trackClick('c1');
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.clicks).toBe(3);
  });

  it('tracks conversion with revenue', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ campaignId: 'c1', impressions: 100, clicks: 10, conversions: 2, revenue: 50000, cost: 0, updatedAt: '' }));
    await s.trackConversion('c1', 25000);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.conversions).toBe(3);
    expect(saved.revenue).toBe(75000);
  });

  it('sets cost', async () => {
    await s.setCost('c1', 100000);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.cost).toBe(100000);
  });

  it('calculates CTR', () => {
    expect(s.calculateCTR({ impressions: 1000, clicks: 50 } as any)).toBe(5);
  });

  it('returns 0 CTR for no impressions', () => {
    expect(s.calculateCTR({ impressions: 0, clicks: 0 } as any)).toBe(0);
  });

  it('calculates conversion rate', () => {
    expect(s.calculateConversionRate({ clicks: 100, conversions: 5 } as any)).toBe(5);
  });

  it('calculates ROI', () => {
    expect(s.calculateROI({ revenue: 200000, cost: 100000 } as any)).toBe(100);
  });

  it('calculates ROAS', () => {
    expect(s.calculateROAS({ revenue: 300000, cost: 100000 } as any)).toBe(3);
  });

  it('returns 0 ROI for no cost', () => {
    expect(s.calculateROI({ revenue: 100000, cost: 0 } as any)).toBe(0);
  });

  it('formats summary', () => {
    const f = s.formatMetricsSummary({ campaignId: 'c1', impressions: 1000, clicks: 50, conversions: 5, revenue: 200000, cost: 100000, updatedAt: '' });
    expect(f).toContain('1000 impresiones');
    expect(f).toContain('5%');
    expect(f).toContain('$200.000');
    expect(f).toContain('100%');
  });
});
