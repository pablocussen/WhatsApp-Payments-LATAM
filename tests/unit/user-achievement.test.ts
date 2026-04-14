const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserAchievementService } from '../../src/services/user-achievement.service';

describe('UserAchievementService', () => {
  let s: UserAchievementService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserAchievementService(); mockRedisGet.mockResolvedValue(null); });

  it('exposes catalog', () => {
    const catalog = s.getCatalog();
    expect(catalog.length).toBeGreaterThan(5);
    expect(catalog.some(c => c.code === 'FIRST_PAYMENT')).toBe(true);
  });

  it('unlocks achievement', async () => {
    const a = await s.unlock('u1', 'FIRST_PAYMENT');
    expect(a?.code).toBe('FIRST_PAYMENT');
    expect(a?.pointsAwarded).toBe(50);
  });

  it('rejects unknown code', async () => {
    await expect(s.unlock('u1', 'NONEXISTENT')).rejects.toThrow('no existe');
  });

  it('returns null on duplicate unlock', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ code: 'FIRST_PAYMENT' }]));
    expect(await s.unlock('u1', 'FIRST_PAYMENT')).toBeNull();
  });

  it('checks if unlocked', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ code: 'PAY_10' }]));
    expect(await s.isUnlocked('u1', 'PAY_10')).toBe(true);
    expect(await s.isUnlocked('u1', 'PAY_100')).toBe(false);
  });

  it('sums total points', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { pointsAwarded: 50 }, { pointsAwarded: 100 }, { pointsAwarded: 500 },
    ]));
    expect(await s.getTotalPoints('u1')).toBe(650);
  });

  it('filters by category', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { category: 'PAYMENTS' }, { category: 'SAVINGS' }, { category: 'PAYMENTS' },
    ]));
    const payments = await s.getByCategory('u1', 'PAYMENTS');
    expect(payments).toHaveLength(2);
  });

  it('filters by tier', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { tier: 'BRONZE' }, { tier: 'SILVER' }, { tier: 'BRONZE' }, { tier: 'GOLD' },
    ]));
    expect((await s.getByTier('u1', 'BRONZE'))).toHaveLength(2);
  });

  it('computes progress', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { code: 'FIRST_PAYMENT', tier: 'BRONZE' },
      { code: 'PAY_10', tier: 'BRONZE' },
      { code: 'PAY_100', tier: 'SILVER' },
    ]));
    const p = await s.getProgress('u1');
    expect(p.unlocked).toBe(3);
    expect(p.total).toBeGreaterThan(3);
    expect(p.byTier.BRONZE.unlocked).toBe(2);
    expect(p.byTier.SILVER.unlocked).toBe(1);
  });
});
