const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantPromotionBannerService } from '../../src/services/merchant-promotion-banner.service';

describe('MerchantPromotionBannerService', () => {
  let s: MerchantPromotionBannerService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantPromotionBannerService(); mockRedisGet.mockResolvedValue(null); });

  it('creates banner', async () => {
    const b = await s.createBanner({
      merchantId: 'm1', title: 'Promo', message: '20% off',
      ctaText: 'Comprar', ctaUrl: 'https://x.cl', position: 'TOP', durationDays: 7,
    });
    expect(b.id).toMatch(/^bnr_/);
    expect(b.position).toBe('TOP');
    expect(b.bgColor).toBe('#06b6d4');
  });

  it('rejects long title', async () => {
    await expect(s.createBanner({
      merchantId: 'm1', title: 'x'.repeat(51), message: 'M',
      ctaText: 'C', ctaUrl: 'X', position: 'TOP', durationDays: 7,
    })).rejects.toThrow('50');
  });

  it('rejects invalid duration', async () => {
    await expect(s.createBanner({
      merchantId: 'm1', title: 'X', message: 'M', ctaText: 'C', ctaUrl: 'X', position: 'TOP', durationDays: 100,
    })).rejects.toThrow('90');
  });

  it('tracks impression', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'b1', active: true, impressions: 50, clicks: 0 }));
    await s.trackImpression('b1');
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.impressions).toBe(51);
  });

  it('tracks click', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'b1', active: true, impressions: 100, clicks: 5 }));
    await s.trackClick('b1');
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.clicks).toBe(6);
  });

  it('ignores tracking on inactive', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'b1', active: false, impressions: 0, clicks: 0 }));
    await s.trackImpression('b1');
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('deactivates banner', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'b1', active: true }));
    expect(await s.deactivate('b1')).toBe(true);
  });

  it('calculates CTR', () => {
    expect(s.getCTR({ impressions: 1000, clicks: 50 } as any)).toBe(5);
  });

  it('returns 0 CTR for no impressions', () => {
    expect(s.getCTR({ impressions: 0, clicks: 0 } as any)).toBe(0);
  });
});
