const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantWarrantyService } from '../../src/services/merchant-warranty.service';

describe('MerchantWarrantyService', () => {
  let s: MerchantWarrantyService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantWarrantyService(); mockRedisGet.mockResolvedValue(null); });

  it('creates warranty', async () => {
    const w = await s.createWarranty({ merchantId: 'm1', productId: 'p1', transactionRef: '#WP-1', customerPhone: '+569', durationMonths: 12 });
    expect(w.id).toMatch(/^wnty_/);
    expect(w.status).toBe('ACTIVE');
    expect(w.maxClaims).toBe(3);
  });

  it('rejects invalid duration', async () => {
    await expect(s.createWarranty({ merchantId: 'm1', productId: 'p1', transactionRef: 'r', customerPhone: '+569', durationMonths: 100 })).rejects.toThrow('60');
  });

  it('claims active warranty', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'w1', status: 'ACTIVE', endDate: future, claimCount: 0, maxClaims: 3 }));
    const r = await s.claim('w1');
    expect(r.success).toBe(true);
  });

  it('marks expired on claim', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'w1', status: 'ACTIVE', endDate: '2020-01-01', claimCount: 0, maxClaims: 3 }));
    const r = await s.claim('w1');
    expect(r.success).toBe(false);
    expect(r.error).toContain('expirada');
  });

  it('rejects max claims', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'w1', status: 'ACTIVE', endDate: future, claimCount: 3, maxClaims: 3 }));
    const r = await s.claim('w1');
    expect(r.success).toBe(false);
    expect(r.error).toContain('Maximo');
  });

  it('voids warranty', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'w1', status: 'ACTIVE' }));
    expect(await s.voidWarranty('w1')).toBe(true);
  });

  it('checks validity', () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    expect(s.isValid({ status: 'ACTIVE', endDate: future, claimCount: 0, maxClaims: 3 } as any)).toBe(true);
    expect(s.isValid({ status: 'EXPIRED', endDate: future, claimCount: 0, maxClaims: 3 } as any)).toBe(false);
  });
});
