const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantPricingRuleService } from '../../src/services/merchant-pricing-rule.service';

describe('MerchantPricingRuleService', () => {
  let s: MerchantPricingRuleService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantPricingRuleService(); mockRedisGet.mockResolvedValue(null); });

  it('creates bulk discount rule', async () => {
    const r = await s.create({
      merchantId: 'm1', name: 'Por 10+', ruleType: 'BULK_DISCOUNT',
      priority: 50, discountType: 'PERCENTAGE', discountValue: 15, minQuantity: 10,
    });
    expect(r.active).toBe(true);
    expect(r.timesApplied).toBe(0);
  });

  it('creates time based rule', async () => {
    const r = await s.create({
      merchantId: 'm1', name: 'Happy hour', ruleType: 'TIME_BASED',
      priority: 60, discountType: 'PERCENTAGE', discountValue: 20,
      startHour: 18, endHour: 20,
    });
    expect(r.startHour).toBe(18);
  });

  it('rejects percentage over 100', async () => {
    await expect(s.create({
      merchantId: 'm1', name: 'x', ruleType: 'BULK_DISCOUNT',
      priority: 1, discountType: 'PERCENTAGE', discountValue: 150, minQuantity: 2,
    })).rejects.toThrow('100');
  });

  it('rejects bulk without minQuantity', async () => {
    await expect(s.create({
      merchantId: 'm1', name: 'x', ruleType: 'BULK_DISCOUNT',
      priority: 1, discountType: 'FIXED', discountValue: 100,
    })).rejects.toThrow('minQuantity');
  });

  it('rejects time based without hours', async () => {
    await expect(s.create({
      merchantId: 'm1', name: 'x', ruleType: 'TIME_BASED',
      priority: 1, discountType: 'FIXED', discountValue: 100,
    })).rejects.toThrow('startHour');
  });

  it('rejects invalid hours', async () => {
    await expect(s.create({
      merchantId: 'm1', name: 'x', ruleType: 'TIME_BASED',
      priority: 1, discountType: 'FIXED', discountValue: 100,
      startHour: 25, endHour: 20,
    })).rejects.toThrow('0 y 23');
  });

  it('toggles active', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'r1', active: true }]));
    const r = await s.toggleActive('m1', 'r1');
    expect(r?.active).toBe(false);
  });

  it('deletes rule', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'r1' }, { id: 'r2' }]));
    expect(await s.delete('m1', 'r1')).toBe(true);
  });

  it('finds best rule by priority', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'r1', active: true, ruleType: 'BULK_DISCOUNT', priority: 30, minQuantity: 5, discountType: 'PERCENTAGE', discountValue: 10 },
      { id: 'r2', active: true, ruleType: 'BULK_DISCOUNT', priority: 80, minQuantity: 10, discountType: 'PERCENTAGE', discountValue: 15 },
    ]));
    const best = await s.findBestRule('m1', { quantity: 15 });
    expect(best?.id).toBe('r2');
  });

  it('skips inactive rules', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'r1', active: false, ruleType: 'BULK_DISCOUNT', priority: 99, minQuantity: 5 },
    ]));
    const best = await s.findBestRule('m1', { quantity: 10 });
    expect(best).toBeNull();
  });

  it('matches customer tier rule', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'r1', active: true, ruleType: 'CUSTOMER_TIER', priority: 50, customerTier: 'GOLD', discountType: 'PERCENTAGE', discountValue: 10 },
    ]));
    const best = await s.findBestRule('m1', { customerTier: 'GOLD' });
    expect(best?.id).toBe('r1');
  });

  it('applies percentage discount', async () => {
    const rule = { id: 'r1', active: true, discountType: 'PERCENTAGE' as const, discountValue: 20 } as any;
    const final = await s.applyDiscount(10000, rule);
    expect(final).toBe(8000);
  });

  it('applies fixed discount capped at zero', async () => {
    const rule = { id: 'r1', active: true, discountType: 'FIXED' as const, discountValue: 15000 } as any;
    const final = await s.applyDiscount(10000, rule);
    expect(final).toBe(0);
  });

  it('records application', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'r1', timesApplied: 5 }]));
    const r = await s.recordApplication('m1', 'r1');
    expect(r?.timesApplied).toBe(6);
  });
});
