/**
 * DiscountCodeService — códigos de descuento para merchants.
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

import { DiscountCodeService } from '../../src/services/discount-code.service';

describe('DiscountCodeService', () => {
  let service: DiscountCodeService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DiscountCodeService();
    mockRedisGet.mockResolvedValue(null);
  });

  it('creates percentage discount', async () => {
    const d = await service.createCode({
      merchantId: 'm1', code: 'VERANO10', type: 'PERCENTAGE', value: 10,
    });
    expect(d.id).toMatch(/^dsc_/);
    expect(d.code).toBe('VERANO10');
    expect(d.type).toBe('PERCENTAGE');
    expect(d.value).toBe(10);
    expect(d.active).toBe(true);
  });

  it('creates fixed discount', async () => {
    const d = await service.createCode({
      merchantId: 'm1', code: 'PROMO', type: 'FIXED', value: 5000,
    });
    expect(d.type).toBe('FIXED');
    expect(d.value).toBe(5000);
  });

  it('uppercases code', async () => {
    const d = await service.createCode({
      merchantId: 'm1', code: 'verano', type: 'PERCENTAGE', value: 10,
    });
    expect(d.code).toBe('VERANO');
  });

  it('rejects percentage over 50%', async () => {
    await expect(service.createCode({ merchantId: 'm1', code: 'X', type: 'PERCENTAGE', value: 60 }))
      .rejects.toThrow('50%');
  });

  it('rejects fixed below $100', async () => {
    await expect(service.createCode({ merchantId: 'm1', code: 'X', type: 'FIXED', value: 50 }))
      .rejects.toThrow('$100');
  });

  it('rejects duplicate code', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ code: 'VERANO10' }]));
    await expect(service.createCode({ merchantId: 'm1', code: 'verano10', type: 'PERCENTAGE', value: 10 }))
      .rejects.toThrow('duplicado');
  });

  it('applies percentage discount', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { code: 'SAVE10', type: 'PERCENTAGE', value: 10, active: true, usedCount: 0, maxUses: 100, expiresAt: null, minPurchase: 0 },
    ]));
    const result = await service.applyCode('m1', 'save10', 50000);
    expect(result.valid).toBe(true);
    expect(result.discount).toBe(5000);
  });

  it('applies fixed discount', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { code: 'OFF3K', type: 'FIXED', value: 3000, active: true, usedCount: 0, maxUses: 100, expiresAt: null, minPurchase: 0 },
    ]));
    const result = await service.applyCode('m1', 'OFF3K', 10000);
    expect(result.valid).toBe(true);
    expect(result.discount).toBe(3000);
  });

  it('caps fixed discount at purchase amount', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { code: 'BIG', type: 'FIXED', value: 10000, active: true, usedCount: 0, maxUses: 100, expiresAt: null, minPurchase: 0 },
    ]));
    const result = await service.applyCode('m1', 'BIG', 5000);
    expect(result.discount).toBe(5000);
  });

  it('rejects invalid code', async () => {
    const result = await service.applyCode('m1', 'NOPE', 10000);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('no válido');
  });

  it('rejects exhausted code', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { code: 'USED', type: 'PERCENTAGE', value: 10, active: true, usedCount: 100, maxUses: 100, expiresAt: null, minPurchase: 0 },
    ]));
    const result = await service.applyCode('m1', 'USED', 10000);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('agotado');
  });

  it('rejects below min purchase', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { code: 'MIN', type: 'PERCENTAGE', value: 10, active: true, usedCount: 0, maxUses: 100, expiresAt: null, minPurchase: 20000 },
    ]));
    const result = await service.applyCode('m1', 'MIN', 10000);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('mínima');
  });

  it('deactivates code', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'dsc_1', active: true }]));
    expect(await service.deactivateCode('m1', 'dsc_1')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].active).toBe(false);
  });

  it('formats summary', () => {
    const summary = service.getCodeSummary({
      id: 'dsc_1', merchantId: 'm1', code: 'VERANO10', type: 'PERCENTAGE',
      value: 10, minPurchase: 0, maxUses: 100, usedCount: 25,
      expiresAt: null, active: true, createdAt: '',
    });
    expect(summary).toContain('VERANO10');
    expect(summary).toContain('10%');
    expect(summary).toContain('25/100');
    expect(summary).toContain('Activo');
  });
});
