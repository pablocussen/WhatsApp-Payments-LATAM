const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }),
}));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantTaxConfigService } from '../../src/services/merchant-tax-config.service';

describe('MerchantTaxConfigService', () => {
  let s: MerchantTaxConfigService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantTaxConfigService(); mockRedisGet.mockResolvedValue(null); });

  it('returns defaults', async () => { const c = await s.getConfig('m1'); expect(c.ivaRate).toBe(19); expect(c.documentType).toBe('BOLETA'); });
  it('updates IVA rate', async () => { const c = await s.updateConfig('m1', { ivaRate: 10 }); expect(c.ivaRate).toBe(10); });
  it('rejects invalid IVA', async () => { await expect(s.updateConfig('m1', { ivaRate: 150 })).rejects.toThrow('100'); });
  it('rejects factura without RUT', async () => { await expect(s.updateConfig('m1', { documentType: 'FACTURA' })).rejects.toThrow('RUT'); });
  it('allows factura with RUT', async () => { const c = await s.updateConfig('m1', { documentType: 'FACTURA', rut: '12345678-9' }); expect(c.documentType).toBe('FACTURA'); });
  it('calculates 19% IVA', () => { const r = s.calculateTax({ ivaRate: 19, exemptCategories: [] } as any, 100000); expect(r.ivaAmount).toBe(19000); expect(r.total).toBe(119000); expect(r.isExempt).toBe(false); });
  it('exempts category', () => { const r = s.calculateTax({ ivaRate: 19, exemptCategories: ['salud'] } as any, 100000, 'salud'); expect(r.ivaAmount).toBe(0); expect(r.isExempt).toBe(true); });
  it('calculates 0% for exempt', () => { const r = s.calculateTax({ ivaRate: 19, exemptCategories: ['edu'] } as any, 50000, 'edu'); expect(r.rate).toBe(0); expect(r.total).toBe(50000); });
  it('formats summary', () => { const f = s.formatTaxSummary(1000000, 200000, 19); expect(f).toContain('19%'); expect(f).toContain('$1.000.000'); expect(f).toContain('$200.000'); });
  it('updates exempt categories', async () => { const c = await s.updateConfig('m1', { exemptCategories: ['salud', 'educacion'] }); expect(c.exemptCategories).toHaveLength(2); });
});
