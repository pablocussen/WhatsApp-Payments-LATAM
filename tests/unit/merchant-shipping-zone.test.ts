const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantShippingZoneService } from '../../src/services/merchant-shipping-zone.service';

describe('MerchantShippingZoneService', () => {
  let s: MerchantShippingZoneService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantShippingZoneService(); mockRedisGet.mockResolvedValue(null); });

  it('creates zone', async () => {
    const z = await s.createZone({ merchantId: 'm1', name: 'RM Centro', comunas: ['Santiago', 'Providencia'], baseFee: 3000, estimatedDays: 1 });
    expect(z.id).toMatch(/^zone_/);
    expect(z.comunas).toEqual(['santiago', 'providencia']);
  });
  it('rejects no comunas', async () => {
    await expect(s.createZone({ merchantId: 'm1', name: 'X', comunas: [], baseFee: 3000, estimatedDays: 1 })).rejects.toThrow('comuna');
  });
  it('rejects negative fee', async () => {
    await expect(s.createZone({ merchantId: 'm1', name: 'X', comunas: ['A'], baseFee: -100, estimatedDays: 1 })).rejects.toThrow('negativa');
  });
  it('rejects over 30 days', async () => {
    await expect(s.createZone({ merchantId: 'm1', name: 'X', comunas: ['A'], baseFee: 1000, estimatedDays: 50 })).rejects.toThrow('30');
  });
  it('rejects over 20 zones', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ id: 'z' + i }))));
    await expect(s.createZone({ merchantId: 'm1', name: 'X', comunas: ['A'], baseFee: 1000, estimatedDays: 1 })).rejects.toThrow('20');
  });
  it('finds zone for comuna', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'z1', active: true, comunas: ['santiago', 'providencia'] },
      { id: 'z2', active: true, comunas: ['las condes'] },
    ]));
    const z = await s.findZoneForComuna('m1', 'Providencia');
    expect(z?.id).toBe('z1');
  });
  it('returns null if no zone matches', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'z1', active: true, comunas: ['santiago'] }]));
    expect(await s.findZoneForComuna('m1', 'Nogales')).toBeNull();
  });
  it('calculates fee', () => {
    expect(s.calculateShippingFee({ baseFee: 3000, freeShippingThreshold: null } as any, 50000)).toBe(3000);
  });
  it('returns 0 over free threshold', () => {
    expect(s.calculateShippingFee({ baseFee: 3000, freeShippingThreshold: 30000 } as any, 50000)).toBe(0);
  });
  it('formats summary', () => {
    const f = s.formatZoneSummary({ name: 'RM', comunas: ['a', 'b', 'c'], baseFee: 3000, estimatedDays: 2, freeShippingThreshold: 30000 } as any);
    expect(f).toContain('RM');
    expect(f).toContain('3 comunas');
    expect(f).toContain('$3.000');
    expect(f).toContain('$30.000');
  });
});
