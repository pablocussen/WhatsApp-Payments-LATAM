/**
 * MerchantCatalogService — product catalog for merchants.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { MerchantCatalogService } from '../../src/services/merchant-catalog.service';

describe('MerchantCatalogService', () => {
  let service: MerchantCatalogService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MerchantCatalogService();
    mockRedisGet.mockResolvedValue(null);
  });

  it('adds a product', async () => {
    const p = await service.addProduct({ merchantId: 'm1', name: 'Empanada', price: 2500 });
    expect(p.id).toMatch(/^prod_/);
    expect(p.name).toBe('Empanada');
    expect(p.price).toBe(2500);
    expect(p.active).toBe(true);
  });

  it('adds product with all fields', async () => {
    const p = await service.addProduct({
      merchantId: 'm1', name: 'Pizza Napolitana', price: 8500,
      description: 'Pizza artesanal', category: 'Pizza', sku: 'PIZ-001', stock: 50,
    });
    expect(p.sku).toBe('PIZ-001');
    expect(p.stock).toBe(50);
    expect(p.category).toBe('Pizza');
  });

  it('rejects empty name', async () => {
    await expect(service.addProduct({ merchantId: 'm1', name: '', price: 1000 }))
      .rejects.toThrow('Nombre');
  });

  it('rejects zero price', async () => {
    await expect(service.addProduct({ merchantId: 'm1', name: 'Test', price: 0 }))
      .rejects.toThrow('Precio');
  });

  it('rejects duplicate SKU', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'prod_1', sku: 'DUP-001' }]));
    await expect(service.addProduct({ merchantId: 'm1', name: 'Test', price: 1000, sku: 'DUP-001' }))
      .rejects.toThrow('SKU');
  });

  it('rejects over 100 products', async () => {
    const existing = Array.from({ length: 100 }, (_, i) => ({ id: `prod_${i}` }));
    mockRedisGet.mockResolvedValue(JSON.stringify(existing));
    await expect(service.addProduct({ merchantId: 'm1', name: 'Extra', price: 500 }))
      .rejects.toThrow('100');
  });

  it('returns empty for new merchant', async () => {
    expect(await service.getProducts('m1')).toEqual([]);
  });

  it('filters active products with stock', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'p1', active: true, stock: 5 },
      { id: 'p2', active: true, stock: 0 },
      { id: 'p3', active: false, stock: 10 },
      { id: 'p4', active: true, stock: null },
    ]));
    const active = await service.getActiveProducts('m1');
    expect(active.map(p => p.id)).toEqual(['p1', 'p4']);
  });

  it('updates a product', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'prod_1', name: 'Old', price: 1000, active: true },
    ]));
    const updated = await service.updateProduct('m1', 'prod_1', { name: 'New', price: 2000 });
    expect(updated?.name).toBe('New');
    expect(updated?.price).toBe(2000);
  });

  it('returns null for non-existent product update', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([]));
    expect(await service.updateProduct('m1', 'nope', { name: 'X' })).toBeNull();
  });

  it('deletes a product', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'prod_1' }, { id: 'prod_2' },
    ]));
    expect(await service.deleteProduct('m1', 'prod_1')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved).toHaveLength(1);
  });

  it('decrements stock', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'prod_1', stock: 10 },
    ]));
    expect(await service.decrementStock('m1', 'prod_1', 3)).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].stock).toBe(7);
  });

  it('rejects decrement below 0', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'prod_1', stock: 2 },
    ]));
    expect(await service.decrementStock('m1', 'prod_1', 5)).toBe(false);
  });

  it('searches products', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'p1', name: 'Empanada Pino', active: true, stock: null, description: null, category: 'Comida', sku: null },
      { id: 'p2', name: 'Pizza', active: true, stock: null, description: 'Italiana', category: null, sku: null },
      { id: 'p3', name: 'Bebida', active: true, stock: null, description: null, category: null, sku: null },
    ]));
    const results = await service.searchProducts('m1', 'pino');
    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('p1');
  });

  it('formats product line', () => {
    const line = service.getProductLine({
      id: 'p1', merchantId: 'm1', name: 'Empanada', description: null,
      price: 2500, category: null, sku: null, active: true, stock: 10,
      imageUrl: null, createdAt: '', updatedAt: '',
    });
    expect(line).toContain('Empanada');
    expect(line).toContain('$2.500');
    expect(line).toContain('Stock: 10');
  });
});
