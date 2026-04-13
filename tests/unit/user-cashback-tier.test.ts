const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserCashbackTierService } from '../../src/services/user-cashback-tier.service';

describe('UserCashbackTierService', () => {
  let s: UserCashbackTierService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserCashbackTierService(); mockRedisGet.mockResolvedValue(null); });

  it('returns default BRONZE tier', async () => {
    const t = await s.get('u1');
    expect(t.tier).toBe('BRONZE');
    expect(t.cashbackRate).toBe(0.005);
    expect(t.nextTierAt).toBe(100000);
  });

  it('records spend and upgrades to SILVER', async () => {
    const t = await s.recordSpend('u1', 150000);
    expect(t.tier).toBe('SILVER');
    expect(t.cashbackRate).toBe(0.010);
    expect(t.totalEarned).toBe(1500);
  });

  it('upgrades to GOLD', async () => {
    const t = await s.recordSpend('u1', 600000);
    expect(t.tier).toBe('GOLD');
    expect(t.cashbackRate).toBe(0.015);
  });

  it('upgrades to PLATINUM with no next tier', async () => {
    const t = await s.recordSpend('u1', 3000000);
    expect(t.tier).toBe('PLATINUM');
    expect(t.nextTierAt).toBe(0);
    expect(t.totalEarned).toBe(75000);
  });

  it('rejects zero or negative spend', async () => {
    await expect(s.recordSpend('u1', 0)).rejects.toThrow('positivo');
    await expect(s.recordSpend('u1', -100)).rejects.toThrow('positivo');
  });

  it('accumulates spend across calls', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ userId: 'u1', tier: 'SILVER', monthlySpend: 150000, cashbackRate: 0.010, totalEarned: 1500, nextTierAt: 500000, updatedAt: '' }));
    const t = await s.recordSpend('u1', 400000);
    expect(t.monthlySpend).toBe(550000);
    expect(t.tier).toBe('GOLD');
  });

  it('resets monthly spend', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ userId: 'u1', tier: 'GOLD', monthlySpend: 600000, cashbackRate: 0.015, totalEarned: 9000, nextTierAt: 2000000, updatedAt: '' }));
    const t = await s.resetMonthly('u1');
    expect(t.monthlySpend).toBe(0);
    expect(t.tier).toBe('BRONZE');
    expect(t.totalEarned).toBe(9000);
  });

  it('formats tier info with remaining', () => {
    const f = s.formatTierInfo({ userId: 'u1', tier: 'SILVER', monthlySpend: 200000, cashbackRate: 0.010, totalEarned: 2000, nextTierAt: 500000, updatedAt: '' });
    expect(f).toContain('SILVER');
    expect(f).toContain('1.0%');
    expect(f).toContain('300.000');
  });

  it('formats PLATINUM as max tier', () => {
    const f = s.formatTierInfo({ userId: 'u1', tier: 'PLATINUM', monthlySpend: 3000000, cashbackRate: 0.025, totalEarned: 75000, nextTierAt: 0, updatedAt: '' });
    expect(f).toContain('maximo');
  });
});
