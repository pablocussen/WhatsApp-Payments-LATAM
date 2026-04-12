const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantReturnPolicyService } from '../../src/services/merchant-return-policy.service';

describe('MerchantReturnPolicyService', () => {
  let s: MerchantReturnPolicyService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantReturnPolicyService(); mockRedisGet.mockResolvedValue(null); });

  it('returns defaults', async () => {
    const p = await s.getPolicy('m1');
    expect(p.windowDays).toBe(30);
    expect(p.requireReceipt).toBe(true);
  });

  it('updates policy', async () => {
    const p = await s.updatePolicy('m1', { windowDays: 60, restockingFee: 10 });
    expect(p.windowDays).toBe(60);
    expect(p.restockingFee).toBe(10);
  });

  it('rejects invalid window', async () => {
    await expect(s.updatePolicy('m1', { windowDays: 200 })).rejects.toThrow('180');
  });

  it('rejects invalid fee', async () => {
    await expect(s.updatePolicy('m1', { restockingFee: 60 })).rejects.toThrow('50');
  });

  it('allows return within window', () => {
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const r = s.canReturn({ windowDays: 30, excludedCategories: [] } as any, recent, 'OTHER');
    expect(r.allowed).toBe(true);
  });

  it('rejects outside window', () => {
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const r = s.canReturn({ windowDays: 30, excludedCategories: [] } as any, old, 'OTHER');
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('ventana');
  });

  it('rejects excluded category', () => {
    const recent = new Date(Date.now() - 1000).toISOString();
    const r = s.canReturn({ windowDays: 30, excludedCategories: ['FOOD'] } as any, recent, 'FOOD');
    expect(r.allowed).toBe(false);
  });

  it('calculates refund with fee', () => {
    expect(s.calculateRefund({ restockingFee: 10 } as any, 100000)).toBe(90000);
  });

  it('calculates full refund with 0 fee', () => {
    expect(s.calculateRefund({ restockingFee: 0 } as any, 50000)).toBe(50000);
  });
});
