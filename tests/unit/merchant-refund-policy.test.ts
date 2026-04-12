const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantRefundPolicyService } from '../../src/services/merchant-refund-policy.service';

describe('MerchantRefundPolicyService', () => {
  let s: MerchantRefundPolicyService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantRefundPolicyService(); mockRedisGet.mockResolvedValue(null); });

  it('returns defaults', async () => { const p = await s.getPolicy('m1'); expect(p.enabled).toBe(true); expect(p.autoRefundMaxAmount).toBe(50000); expect(p.refundWindowHours).toBe(72); });
  it('updates policy', async () => { const p = await s.updatePolicy('m1', { autoRefundMaxAmount: 100000, refundWindowHours: 48 }); expect(p.autoRefundMaxAmount).toBe(100000); expect(p.refundWindowHours).toBe(48); });
  it('rejects negative amount', async () => { await expect(s.updatePolicy('m1', { autoRefundMaxAmount: -1 })).rejects.toThrow('positivo'); });
  it('rejects invalid window', async () => { await expect(s.updatePolicy('m1', { refundWindowHours: 1000 })).rejects.toThrow('720'); });
  it('allows auto-refund within limits', () => { const r = s.canAutoRefund({ enabled: true, autoRefundMaxAmount: 50000, refundWindowHours: 72 } as any, 30000, 24); expect(r.allowed).toBe(true); });
  it('rejects disabled', () => { expect(s.canAutoRefund({ enabled: false } as any, 1000, 1).allowed).toBe(false); });
  it('rejects over window', () => { expect(s.canAutoRefund({ enabled: true, refundWindowHours: 72 } as any, 1000, 100).reason).toContain('ventana'); });
  it('rejects over max amount', () => { expect(s.canAutoRefund({ enabled: true, autoRefundMaxAmount: 50000, refundWindowHours: 72 } as any, 60000, 1).reason).toContain('limite'); });
});
