const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantCouponCampaignService } from '../../src/services/merchant-coupon-campaign.service';

describe('MerchantCouponCampaignService', () => {
  let s: MerchantCouponCampaignService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantCouponCampaignService(); mockRedisGet.mockResolvedValue(null); });

  it('creates campaign', async () => {
    const c = await s.createCampaign({ merchantId: 'm1', name: 'Verano', description: 'promo verano', couponCode: 'verano', targetAudience: 'ALL', durationDays: 30, maxRedemptions: 100 });
    expect(c.id).toMatch(/^camp_/);
    expect(c.couponCode).toBe('VERANO');
    expect(c.status).toBe('DRAFT');
  });
  it('rejects invalid duration', async () => {
    await expect(s.createCampaign({ merchantId: 'm1', name: 'X', description: 'Y', couponCode: 'X', targetAudience: 'ALL', durationDays: 500, maxRedemptions: 100 })).rejects.toThrow('365');
  });
  it('activates', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'c1', status: 'DRAFT' }));
    expect(await s.activate('c1')).toBe(true);
    expect(JSON.parse(mockRedisSet.mock.calls[0][1]).status).toBe('ACTIVE');
  });
  it('pauses active', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'c1', status: 'ACTIVE' }));
    expect(await s.pause('c1')).toBe(true);
    expect(JSON.parse(mockRedisSet.mock.calls[0][1]).status).toBe('PAUSED');
  });
  it('records redemption', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'c1', status: 'ACTIVE', redemptions: 5, maxRedemptions: 100, totalDiscount: 10000 }));
    expect(await s.recordRedemption('c1', 2000)).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.redemptions).toBe(6);
    expect(saved.totalDiscount).toBe(12000);
  });
  it('ends when reaching max redemptions', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'c1', status: 'ACTIVE', redemptions: 99, maxRedemptions: 100, totalDiscount: 0 }));
    await s.recordRedemption('c1', 1000);
    expect(JSON.parse(mockRedisSet.mock.calls[0][1]).status).toBe('ENDED');
  });
  it('rejects redemption on non-active', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'c1', status: 'PAUSED' }));
    expect(await s.recordRedemption('c1', 1000)).toBe(false);
  });
  it('formats summary', () => {
    const f = s.formatCampaignSummary({ name: 'Verano', couponCode: 'VERANO', redemptions: 50, maxRedemptions: 100, totalDiscount: 500000, status: 'ACTIVE' } as any);
    expect(f).toContain('Verano');
    expect(f).toContain('50/100');
    expect(f).toContain('$500.000');
  });
});
