const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantStampCardService } from '../../src/services/merchant-stamp-card.service';

describe('MerchantStampCardService', () => {
  let s: MerchantStampCardService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantStampCardService(); mockRedisGet.mockResolvedValue(null); });

  it('creates config', async () => {
    const c = await s.createConfig({ merchantId: 'm1', name: '10 cafes', description: 'Compra 10 lleva 1', stampsRequired: 10, rewardDescription: 'Cafe gratis' });
    expect(c.stampsRequired).toBe(10);
    expect(c.active).toBe(true);
  });

  it('rejects invalid stamps count', async () => {
    await expect(s.createConfig({ merchantId: 'm1', name: 'x', description: 'y', stampsRequired: 2, rewardDescription: 'z' })).rejects.toThrow('3 y 30');
    await expect(s.createConfig({ merchantId: 'm1', name: 'x', description: 'y', stampsRequired: 50, rewardDescription: 'z' })).rejects.toThrow('3 y 30');
  });

  it('rejects long name', async () => {
    await expect(s.createConfig({ merchantId: 'm1', name: 'x'.repeat(41), description: 'y', stampsRequired: 10, rewardDescription: 'z' })).rejects.toThrow('40');
  });

  it('adds stamp and marks ready at threshold', async () => {
    mockRedisGet
      .mockResolvedValueOnce(JSON.stringify({ merchantId: 'm1', stampsRequired: 3, active: true }))
      .mockResolvedValueOnce(JSON.stringify({ customerId: 'c1', merchantId: 'm1', stamps: 2, redemptions: 0, readyToRedeem: false }));
    const card = await s.addStamp('m1', 'c1');
    expect(card.stamps).toBe(3);
    expect(card.readyToRedeem).toBe(true);
  });

  it('rejects stamp when program inactive', async () => {
    mockRedisGet.mockResolvedValueOnce(JSON.stringify({ active: false }));
    await expect(s.addStamp('m1', 'c1')).rejects.toThrow('no activo');
  });

  it('redeems and resets stamps', async () => {
    mockRedisGet
      .mockResolvedValueOnce(JSON.stringify({ merchantId: 'm1', stampsRequired: 10, active: true }))
      .mockResolvedValueOnce(JSON.stringify({ customerId: 'c1', merchantId: 'm1', stamps: 10, redemptions: 1, readyToRedeem: true }));
    const card = await s.redeem('m1', 'c1');
    expect(card.stamps).toBe(0);
    expect(card.redemptions).toBe(2);
    expect(card.readyToRedeem).toBe(false);
  });

  it('rejects redeem when not enough stamps', async () => {
    mockRedisGet
      .mockResolvedValueOnce(JSON.stringify({ merchantId: 'm1', stampsRequired: 10, active: true }))
      .mockResolvedValueOnce(JSON.stringify({ customerId: 'c1', stamps: 5 }));
    await expect(s.redeem('m1', 'c1')).rejects.toThrow('Faltan 5');
  });

  it('deactivates program', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ merchantId: 'm1', active: true }));
    expect(await s.deactivate('m1')).toBe(true);
  });

  it('formats progress', () => {
    const f = s.formatProgress(
      { customerId: 'c1', merchantId: 'm1', stamps: 7, redemptions: 0, readyToRedeem: false },
      { merchantId: 'm1', name: '10 cafes', description: '', stampsRequired: 10, rewardDescription: 'Cafe gratis', active: true, createdAt: '' }
    );
    expect(f).toContain('●●●●●●●');
    expect(f).toContain('○○○');
    expect(f).toContain('3 sellos restantes');
  });

  it('formats ready state', () => {
    const f = s.formatProgress(
      { customerId: 'c1', merchantId: 'm1', stamps: 10, redemptions: 0, readyToRedeem: true },
      { merchantId: 'm1', name: 'x', description: '', stampsRequired: 10, rewardDescription: 'y', active: true, createdAt: '' }
    );
    expect(f).toContain('LISTO PARA CANJEAR');
  });
});
