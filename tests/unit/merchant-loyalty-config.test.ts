/**
 * MerchantLoyaltyConfigService — configuración programa fidelización.
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

import { MerchantLoyaltyConfigService } from '../../src/services/merchant-loyalty-config.service';

describe('MerchantLoyaltyConfigService', () => {
  let service: MerchantLoyaltyConfigService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MerchantLoyaltyConfigService();
    mockRedisGet.mockResolvedValue(null);
  });

  it('returns defaults', async () => {
    const c = await service.getConfig('m1');
    expect(c.enabled).toBe(false);
    expect(c.tiers).toHaveLength(4);
    expect(c.tiers[0].name).toBe('Bronce');
    expect(c.welcomeBonus).toBe(100);
  });

  it('enables loyalty', async () => {
    const c = await service.updateConfig('m1', { enabled: true });
    expect(c.enabled).toBe(true);
    expect(mockRedisSet).toHaveBeenCalled();
  });

  it('updates points rate', async () => {
    const c = await service.updateConfig('m1', { pointsPerCLP: 2 });
    expect(c.pointsPerCLP).toBe(2);
  });

  it('rejects zero points rate', async () => {
    await expect(service.updateConfig('m1', { pointsPerCLP: 0 }))
      .rejects.toThrow('mayor a 0');
  });

  it('rejects over 6 tiers', async () => {
    const tiers = Array.from({ length: 7 }, (_, i) => ({ name: `T${i}`, minPoints: i * 100, multiplier: 1, perks: [] }));
    await expect(service.updateConfig('m1', { tiers }))
      .rejects.toThrow('6');
  });

  it('calculates base points', () => {
    const config = {
      merchantId: 'm1', enabled: true, pointsPerCLP: 1,
      tiers: [{ name: 'Bronce', minPoints: 0, multiplier: 1, perks: [] }],
      redeemRate: 100, welcomeBonus: 0, birthdayBonus: 0, updatedAt: '',
    };
    // $10,000 CLP = 100 base points * 1x multiplier = 100
    expect(service.calculatePoints(config, 10000, 0)).toBe(100);
  });

  it('applies tier multiplier', () => {
    const config = {
      merchantId: 'm1', enabled: true, pointsPerCLP: 1,
      tiers: [
        { name: 'Bronce', minPoints: 0, multiplier: 1, perks: [] },
        { name: 'Oro', minPoints: 2000, multiplier: 2, perks: [] },
      ],
      redeemRate: 100, welcomeBonus: 0, birthdayBonus: 0, updatedAt: '',
    };
    // $10,000 CLP = 100 base * 2x = 200
    expect(service.calculatePoints(config, 10000, 2500)).toBe(200);
  });

  it('returns 0 when disabled', () => {
    const config = {
      merchantId: 'm1', enabled: false, pointsPerCLP: 1,
      tiers: [{ name: 'Bronce', minPoints: 0, multiplier: 1, perks: [] }],
      redeemRate: 100, welcomeBonus: 0, birthdayBonus: 0, updatedAt: '',
    };
    expect(service.calculatePoints(config, 10000, 0)).toBe(0);
  });

  it('gets correct tier', () => {
    const config = {
      merchantId: 'm1', enabled: true, pointsPerCLP: 1,
      tiers: [
        { name: 'Bronce', minPoints: 0, multiplier: 1, perks: [] },
        { name: 'Plata', minPoints: 500, multiplier: 1.5, perks: [] },
        { name: 'Oro', minPoints: 2000, multiplier: 2, perks: [] },
      ],
      redeemRate: 100, welcomeBonus: 0, birthdayBonus: 0, updatedAt: '',
    };
    expect(service.getTier(config, 0).name).toBe('Bronce');
    expect(service.getTier(config, 500).name).toBe('Plata');
    expect(service.getTier(config, 3000).name).toBe('Oro');
  });

  it('converts points to CLP', () => {
    const config = {
      merchantId: 'm1', enabled: true, pointsPerCLP: 1,
      tiers: [], redeemRate: 100, welcomeBonus: 0, birthdayBonus: 0, updatedAt: '',
    };
    expect(service.pointsToCLP(config, 1000)).toBe(10); // 1000/100 = $10
    expect(service.pointsToCLP(config, 550)).toBe(5); // floor(550/100) = $5
  });
});
