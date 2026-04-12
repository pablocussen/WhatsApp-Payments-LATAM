const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantProductBundleService } from '../../src/services/merchant-product-bundle.service';

describe('MerchantProductBundleService', () => {
  let s: MerchantProductBundleService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantProductBundleService(); mockRedisGet.mockResolvedValue(null); });

  it('creates bundle with discount', async () => {
    const b = await s.createBundle({
      merchantId: 'm1', name: 'Combo Familiar',
      items: [
        { productId: 'p1', name: 'Pizza', quantity: 1, individualPrice: 10000 },
        { productId: 'p2', name: 'Bebida', quantity: 2, individualPrice: 2000 },
      ],
      bundlePrice: 12000,
    });
    expect(b.id).toMatch(/^bnd_/);
    expect(b.totalIndividualPrice).toBe(14000);
    expect(b.discount).toBe(2000);
  });

  it('rejects single item', async () => {
    await expect(s.createBundle({
      merchantId: 'm1', name: 'X',
      items: [{ productId: 'p1', name: 'X', quantity: 1, individualPrice: 1000 }],
      bundlePrice: 900,
    })).rejects.toThrow('2 productos');
  });

  it('rejects bundle not cheaper', async () => {
    await expect(s.createBundle({
      merchantId: 'm1', name: 'X',
      items: [
        { productId: 'p1', name: 'A', quantity: 1, individualPrice: 5000 },
        { productId: 'p2', name: 'B', quantity: 1, individualPrice: 5000 },
      ],
      bundlePrice: 10000,
    })).rejects.toThrow('barato');
  });

  it('returns null for missing bundle', async () => {
    expect(await s.getBundle('nope')).toBeNull();
  });

  it('deactivates bundle', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'b1', active: true }));
    expect(await s.deactivate('b1')).toBe(true);
  });

  it('calculates discount percent', () => {
    expect(s.getDiscountPercent({ discount: 2000, totalIndividualPrice: 10000 } as any)).toBe(20);
  });

  it('formats bundle summary', () => {
    const f = s.formatBundleSummary({
      name: 'Combo', items: [{}, {}, {}], bundlePrice: 15000, discount: 3000, totalIndividualPrice: 18000,
    } as any);
    expect(f).toContain('Combo');
    expect(f).toContain('3 productos');
    expect(f).toContain('$15.000');
    expect(f).toContain('17%');
  });
});
