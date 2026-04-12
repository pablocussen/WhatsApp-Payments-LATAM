const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantSubscriptionPlanService } from '../../src/services/merchant-subscription-plan.service';

describe('MerchantSubscriptionPlanService', () => {
  let s: MerchantSubscriptionPlanService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantSubscriptionPlanService(); mockRedisGet.mockResolvedValue(null); });

  it('subscribes to PRO monthly', async () => { const p = await s.subscribe('m1', 'PRO', 'MONTHLY'); expect(p.tier).toBe('PRO'); expect(p.price).toBe(19990); expect(p.apiAccess).toBe(true); expect(p.maxTeamMembers).toBe(5); });
  it('subscribes to BUSINESS annual', async () => { const p = await s.subscribe('m1', 'BUSINESS', 'ANNUAL'); expect(p.price).toBe(499900); expect(p.webhookAccess).toBe(true); });
  it('returns FREE by default', async () => { const p = await s.getPlan('m1'); expect(p.tier).toBe('FREE'); expect(p.price).toBe(0); expect(p.apiAccess).toBe(false); });
  it('cancels paid plan', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ tier: 'PRO', active: true }));
    expect(await s.cancelPlan('m1')).toBe(true);
  });
  it('cannot cancel FREE', async () => { expect(await s.cancelPlan('m1')).toBe(false); });
  it('upgrades plan', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ tier: 'PRO', billingCycle: 'MONTHLY', active: true }));
    const p = await s.upgradePlan('m1', 'BUSINESS');
    expect(p.tier).toBe('BUSINESS');
  });
  it('rejects downgrade', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ tier: 'BUSINESS', billingCycle: 'MONTHLY', active: true }));
    await expect(s.upgradePlan('m1', 'PRO')).rejects.toThrow('subir');
  });
  it('checks feature access', () => {
    expect(s.canAccess({ active: true, apiAccess: true, webhookAccess: false, prioritySupport: false } as any, 'api')).toBe(true);
    expect(s.canAccess({ active: true, apiAccess: false } as any, 'api')).toBe(false);
    expect(s.canAccess({ active: false, apiAccess: true } as any, 'api')).toBe(false);
  });
  it('formats summary', () => {
    const f = s.formatPlanSummary({ tier: 'PRO', billingCycle: 'MONTHLY', price: 19990, features: ['A', 'B', 'C'], active: true } as any);
    expect(f).toContain('PRO'); expect(f).toContain('$19.990'); expect(f).toContain('3 features');
  });
  it('lists available plans', () => { const plans = s.getAvailablePlans(); expect(plans).toHaveLength(4); expect(plans[0].tier).toBe('FREE'); expect(plans[1].monthlyPrice).toBe(19990); });
});
