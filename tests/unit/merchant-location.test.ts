/**
 * MerchantLocationService — ubicaciones de comercios + búsqueda cercana.
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

import { MerchantLocationService } from '../../src/services/merchant-location.service';

describe('MerchantLocationService', () => {
  let service: MerchantLocationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MerchantLocationService();
    mockRedisGet.mockResolvedValue(null);
  });

  it('sets location', async () => {
    const loc = await service.setLocation({
      merchantId: 'm1', name: 'Café Central', address: 'Av. Providencia 123',
      city: 'Santiago', region: 'RM', lat: -33.4372, lng: -70.6506,
    });
    expect(loc.merchantId).toBe('m1');
    expect(loc.lat).toBe(-33.4372);
    expect(loc.acceptsQR).toBe(true);
    expect(loc.rating).toBe(0);
  });

  it('rejects lat outside Chile', async () => {
    await expect(service.setLocation({
      merchantId: 'm1', name: 'X', address: 'X', city: 'X', region: 'X', lat: 40, lng: -70,
    })).rejects.toThrow('Latitud');
  });

  it('rejects lng outside Chile', async () => {
    await expect(service.setLocation({
      merchantId: 'm1', name: 'X', address: 'X', city: 'X', region: 'X', lat: -33, lng: -50,
    })).rejects.toThrow('Longitud');
  });

  it('returns null for no location', async () => {
    expect(await service.getLocation('m1')).toBeNull();
  });

  it('calculates distance Santiago-Valparaíso (~100km)', () => {
    const d = service.calculateDistance(-33.4489, -70.6693, -33.0472, -71.6127);
    expect(d).toBeGreaterThan(90);
    expect(d).toBeLessThan(120);
  });

  it('calculates distance same point = 0', () => {
    expect(service.calculateDistance(-33.45, -70.67, -33.45, -70.67)).toBe(0);
  });

  it('finds nearby merchants', () => {
    const locations = [
      { merchantId: 'm1', name: 'Cerca', lat: -33.44, lng: -70.65, active: true } as any,
      { merchantId: 'm2', name: 'Lejos', lat: -33.05, lng: -71.61, active: true } as any,
      { merchantId: 'm3', name: 'Inactivo', lat: -33.44, lng: -70.65, active: false } as any,
    ];
    const nearby = service.findNearby(locations, -33.45, -70.67, 5);
    expect(nearby).toHaveLength(1);
    expect(nearby[0].merchantId).toBe('m1');
    expect(nearby[0].distance).toBeLessThan(5);
  });

  it('adds rating', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      merchantId: 'm1', rating: 4, reviewCount: 10,
    }));
    expect(await service.addRating('m1', 5)).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.reviewCount).toBe(11);
    expect(saved.rating).toBeCloseTo(4.1, 1);
  });

  it('rejects invalid rating', async () => {
    await expect(service.addRating('m1', 6)).rejects.toThrow('1 y 5');
  });

  it('formats location', () => {
    const f = service.formatLocation({
      merchantId: 'm1', name: 'Café Central', address: 'Av. Providencia 123',
      city: 'Santiago', region: 'RM', lat: -33.44, lng: -70.65,
      phone: null, categories: [], acceptsQR: true, acceptsLink: true,
      rating: 4.2, reviewCount: 50, active: true, updatedAt: '',
    });
    expect(f).toContain('Café Central');
    expect(f).toContain('Santiago');
    expect(f).toContain('★★★★☆');
    expect(f).toContain('(50)');
  });
});
