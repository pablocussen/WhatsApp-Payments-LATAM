const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantCouponService } from '../../src/services/merchant-coupon.service';

describe('MerchantCouponService', () => {
  let s: MerchantCouponService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantCouponService(); mockRedisGet.mockResolvedValue(null); });

  it('creates coupon', async () => { const c = await s.createCoupon({ merchantId: 'm1', code: 'VERANO', description: '20% off', discountPercent: 20, maxDiscount: 10000, minPurchase: 5000, validDays: 30, maxRedemptions: 100 }); expect(c.code).toBe('VERANO'); expect(c.active).toBe(true); });
  it('rejects long code', async () => { await expect(s.createCoupon({ merchantId: 'm1', code: 'x'.repeat(16), description: 'X', discountPercent: 10, maxDiscount: 5000, minPurchase: 0, validDays: 30, maxRedemptions: 10 })).rejects.toThrow('15'); });
  it('redeems coupon', async () => {
    const future = new Date(Date.now() + 100000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify({ code: 'VERANO', active: true, validUntil: future, redemptionCount: 0, maxRedemptions: 100, minPurchase: 0, discountPercent: 20, maxDiscount: 10000 }));
    const r = await s.redeemCoupon('VERANO', 50000);
    expect(r.valid).toBe(true);
    expect(r.discount).toBe(10000);
  });
  it('caps discount at maxDiscount', async () => {
    const future = new Date(Date.now() + 100000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify({ code: 'BIG', active: true, validUntil: future, redemptionCount: 0, maxRedemptions: 100, minPurchase: 0, discountPercent: 50, maxDiscount: 5000 }));
    const r = await s.redeemCoupon('BIG', 100000);
    expect(r.discount).toBe(5000);
  });
  it('rejects expired', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ code: 'OLD', active: true, validUntil: '2020-01-01', redemptionCount: 0, maxRedemptions: 100, minPurchase: 0 }));
    const r = await s.redeemCoupon('OLD', 10000);
    expect(r.valid).toBe(false);
    expect(r.error).toContain('expirado');
  });
  it('rejects exhausted', async () => {
    const future = new Date(Date.now() + 100000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify({ code: 'DONE', active: true, validUntil: future, redemptionCount: 100, maxRedemptions: 100, minPurchase: 0 }));
    expect((await s.redeemCoupon('DONE', 10000)).error).toContain('agotado');
  });
  it('deactivates coupon', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ code: 'X', active: true }));
    expect(await s.deactivate('X')).toBe(true);
  });
});
