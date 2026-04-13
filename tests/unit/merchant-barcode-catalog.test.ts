const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantBarcodeCatalogService } from '../../src/services/merchant-barcode-catalog.service';

describe('MerchantBarcodeCatalogService', () => {
  let s: MerchantBarcodeCatalogService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantBarcodeCatalogService(); mockRedisGet.mockResolvedValue(null); });

  const base = { merchantId: 'm1', barcode: '7801234567890', productName: 'Coca Cola 500ml', price: 1200, sku: 'CC500', stock: 100, category: 'Bebidas' };

  it('adds barcode entry', async () => {
    const e = await s.addEntry(base);
    expect(e.scanCount).toBe(0);
    expect(e.barcode).toBe('7801234567890');
  });

  it('rejects invalid barcode', async () => {
    await expect(s.addEntry({ ...base, barcode: 'abc' })).rejects.toThrow('8-14');
    await expect(s.addEntry({ ...base, barcode: '123' })).rejects.toThrow('8-14');
  });

  it('rejects negative price', async () => {
    await expect(s.addEntry({ ...base, price: -100 })).rejects.toThrow('Precio');
  });

  it('rejects negative stock', async () => {
    await expect(s.addEntry({ ...base, stock: -1 })).rejects.toThrow('Stock');
  });

  it('rejects duplicate barcode', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ barcode: '7801234567890' }]));
    await expect(s.addEntry(base)).rejects.toThrow('ya existe');
  });

  it('lookup increments scan count', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ ...base, scanCount: 5 }]));
    const e = await s.lookup('m1', '7801234567890');
    expect(e?.scanCount).toBe(6);
    expect(e?.lastScanAt).toBeDefined();
  });

  it('returns null when barcode not found', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([]));
    expect(await s.lookup('m1', '9999999999999')).toBeNull();
  });

  it('updates stock with delta', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ ...base, stock: 50 }]));
    const e = await s.updateStock('m1', '7801234567890', -10);
    expect(e?.stock).toBe(40);
  });

  it('rejects negative resulting stock', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ ...base, stock: 5 }]));
    await expect(s.updateStock('m1', '7801234567890', -10)).rejects.toThrow('negativo');
  });

  it('updates price', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ ...base, price: 1200 }]));
    const e = await s.updatePrice('m1', '7801234567890', 1500);
    expect(e?.price).toBe(1500);
  });

  it('deletes entry', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ barcode: '7801234567890' }]));
    expect(await s.delete('m1', '7801234567890')).toBe(true);
  });

  it('returns most scanned', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { barcode: '1', scanCount: 5 },
      { barcode: '2', scanCount: 20 },
      { barcode: '3', scanCount: 10 },
    ]));
    const top = await s.getMostScanned('m1', 2);
    expect(top[0].barcode).toBe('2');
    expect(top[1].barcode).toBe('3');
  });

  it('filters low stock', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { barcode: '1', stock: 2 },
      { barcode: '2', stock: 100 },
      { barcode: '3', stock: 5 },
    ]));
    const low = await s.getLowStock('m1', 5);
    expect(low).toHaveLength(2);
  });

  it('searches by name case insensitive', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { barcode: '1', productName: 'Coca Cola 500ml' },
      { barcode: '2', productName: 'Pepsi 500ml' },
    ]));
    const found = await s.searchByName('m1', 'coca');
    expect(found).toHaveLength(1);
    expect(found[0].barcode).toBe('1');
  });
});
