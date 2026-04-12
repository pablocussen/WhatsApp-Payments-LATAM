const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantProductVariantService } from '../../src/services/merchant-product-variant.service';

describe('MerchantProductVariantService', () => {
  let s: MerchantProductVariantService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantProductVariantService(); mockRedisGet.mockResolvedValue(null); });

  it('adds variant', async () => {
    const v = await s.addVariant('p1', { name: 'Talla M', sku: 'TM-001', price: 10000, stock: 20, attributes: { size: 'M', color: 'red' } });
    expect(v.id).toMatch(/^var_/);
    expect(v.active).toBe(true);
  });
  it('rejects duplicate SKU', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ sku: 'TM-001' }]));
    await expect(s.addVariant('p1', { name: 'X', sku: 'TM-001', price: 100, stock: null, attributes: {} })).rejects.toThrow('duplicado');
  });
  it('rejects negative price', async () => {
    await expect(s.addVariant('p1', { name: 'X', sku: 'X', price: -1, stock: null, attributes: {} })).rejects.toThrow('negativo');
  });
  it('rejects over 50 variants', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ sku: 'sku' + i }))));
    await expect(s.addVariant('p1', { name: 'X', sku: 'NEW', price: 100, stock: null, attributes: {} })).rejects.toThrow('50');
  });
  it('filters active variants with stock', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'v1', active: true, stock: 5 },
      { id: 'v2', active: false, stock: 5 },
      { id: 'v3', active: true, stock: 0 },
      { id: 'v4', active: true, stock: null },
    ]));
    const active = await s.getActiveVariants('p1');
    expect(active).toHaveLength(2);
  });
  it('updates stock', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'v1', stock: 10 }]));
    expect(await s.updateStock('p1', 'v1', -3)).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].stock).toBe(7);
  });
  it('rejects stock below 0', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'v1', stock: 5 }]));
    expect(await s.updateStock('p1', 'v1', -10)).toBe(false);
  });
  it('deactivates variant', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'v1', active: true }]));
    expect(await s.deactivateVariant('p1', 'v1')).toBe(true);
  });
  it('formats summary', () => {
    const f = s.formatVariantSummary({ id: 'v1', productId: 'p1', name: 'Talla M', sku: 'TM', price: 10000, stock: 5, attributes: { color: 'red' }, active: true });
    expect(f).toContain('Talla M');
    expect(f).toContain('$10.000');
    expect(f).toContain('Stock: 5');
    expect(f).toContain('color: red');
  });
});
