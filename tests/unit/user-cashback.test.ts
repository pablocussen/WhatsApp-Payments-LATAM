const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserCashbackService } from '../../src/services/user-cashback.service';

describe('UserCashbackService', () => {
  let s: UserCashbackService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserCashbackService(); mockRedisGet.mockResolvedValue(null); });

  it('calculates FOOD cashback 2%', () => {
    expect(s.calculateCashback(100000, 'FOOD')).toBe(2000);
  });

  it('caps at maxPerTx', () => {
    expect(s.calculateCashback(500000, 'FOOD')).toBe(5000);
  });

  it('returns 0 for unknown category', () => {
    expect(s.calculateCashback(100000, 'UNKNOWN')).toBe(0);
  });

  it('earns cashback', async () => {
    const b = await s.earnCashback('u1', 2000);
    expect(b.available).toBe(2000);
    expect(b.totalEarned).toBe(2000);
  });

  it('rejects negative earn', async () => {
    await expect(s.earnCashback('u1', -100)).rejects.toThrow('positivo');
  });

  it('redeems cashback', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ userId: 'u1', available: 5000, totalEarned: 5000, totalRedeemed: 0, lastEarnedAt: null }));
    const r = await s.redeemCashback('u1', 3000);
    expect(r.success).toBe(true);
  });

  it('rejects insufficient redemption', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ userId: 'u1', available: 1000, totalEarned: 1000, totalRedeemed: 0, lastEarnedAt: null }));
    const r = await s.redeemCashback('u1', 5000);
    expect(r.success).toBe(false);
    expect(r.error).toContain('insuficiente');
  });

  it('returns defaults for new user', async () => {
    const b = await s.getBalance('u1');
    expect(b.available).toBe(0);
  });

  it('formats balance', () => {
    const f = s.formatBalance({ userId: 'u1', available: 5000, totalEarned: 10000, totalRedeemed: 5000, lastEarnedAt: null });
    expect(f).toContain('$5.000');
    expect(f).toContain('$10.000');
  });

  it('returns rules', () => {
    expect(s.getRules()).toHaveLength(4);
  });
});
