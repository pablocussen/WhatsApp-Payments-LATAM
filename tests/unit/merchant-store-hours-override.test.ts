const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantStoreHoursOverrideService } from '../../src/services/merchant-store-hours-override.service';

describe('MerchantStoreHoursOverrideService', () => {
  let s: MerchantStoreHoursOverrideService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantStoreHoursOverrideService(); mockRedisGet.mockResolvedValue(null); });

  it('creates closed override', async () => {
    const o = await s.createOverride({ merchantId: 'm1', date: '2026-12-25', type: 'CLOSED', reason: 'Navidad' });
    expect(o.id).toMatch(/^over_/);
    expect(o.type).toBe('CLOSED');
  });
  it('creates extended hours', async () => {
    const o = await s.createOverride({ merchantId: 'm1', date: '2026-12-24', type: 'EXTENDED', openTime: '08:00', closeTime: '23:00', reason: 'Vispera' });
    expect(o.openTime).toBe('08:00');
    expect(o.closeTime).toBe('23:00');
  });
  it('rejects non-closed without hours', async () => {
    await expect(s.createOverride({ merchantId: 'm1', date: '2026-12-24', type: 'EXTENDED', reason: 'X' })).rejects.toThrow('requeridos');
  });
  it('returns null for missing', async () => {
    expect(await s.getOverride('m1', '2026-04-11')).toBeNull();
  });
  it('detects closed', () => {
    expect(s.isClosed({ type: 'CLOSED' } as any)).toBe(true);
    expect(s.isClosed({ type: 'EXTENDED' } as any)).toBe(false);
  });
  it('checks open at time', () => {
    expect(s.isOpenAt({ type: 'EXTENDED', openTime: '08:00', closeTime: '20:00' } as any, '14:00')).toBe(true);
    expect(s.isOpenAt({ type: 'EXTENDED', openTime: '08:00', closeTime: '20:00' } as any, '21:00')).toBe(false);
    expect(s.isOpenAt({ type: 'CLOSED' } as any, '14:00')).toBe(false);
  });
  it('deletes override', async () => {
    expect(await s.deleteOverride('m1', '2026-04-11')).toBe(true);
  });
});
