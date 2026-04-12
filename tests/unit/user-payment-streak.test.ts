const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserPaymentStreakService } from '../../src/services/user-payment-streak.service';

describe('UserPaymentStreakService', () => {
  let s: UserPaymentStreakService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserPaymentStreakService(); mockRedisGet.mockResolvedValue(null); });

  it('starts streak on first payment', async () => {
    const streak = await s.recordPayment('u1');
    expect(streak.currentStreak).toBe(1);
    expect(streak.longestStreak).toBe(1);
    expect(streak.totalDays).toBe(1);
  });

  it('continues streak next day', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    mockRedisGet.mockResolvedValue(JSON.stringify({
      userId: 'u1', currentStreak: 5, longestStreak: 5,
      lastPaymentDate: yesterday, totalDays: 5, achievements: [], updatedAt: '',
    }));
    const streak = await s.recordPayment('u1');
    expect(streak.currentStreak).toBe(6);
  });

  it('breaks streak after gap', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      userId: 'u1', currentStreak: 10, longestStreak: 10,
      lastPaymentDate: '2020-01-01', totalDays: 10, achievements: [], updatedAt: '',
    }));
    const streak = await s.recordPayment('u1');
    expect(streak.currentStreak).toBe(1);
    expect(streak.longestStreak).toBe(10);
  });

  it('does not double-count same day', async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockRedisGet.mockResolvedValue(JSON.stringify({
      userId: 'u1', currentStreak: 5, longestStreak: 5,
      lastPaymentDate: today, totalDays: 5, achievements: [], updatedAt: '',
    }));
    const streak = await s.recordPayment('u1');
    expect(streak.currentStreak).toBe(5);
    expect(streak.totalDays).toBe(5);
  });

  it('updates longest streak', async () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    mockRedisGet.mockResolvedValue(JSON.stringify({
      userId: 'u1', currentStreak: 10, longestStreak: 5,
      lastPaymentDate: yesterday, totalDays: 10, achievements: [], updatedAt: '',
    }));
    const streak = await s.recordPayment('u1');
    expect(streak.longestStreak).toBe(11);
  });

  it('awards SEMANA_PERFECTA at 7 days', () => {
    const a = s.checkAchievements({ currentStreak: 7, totalDays: 7, longestStreak: 7 } as any);
    expect(a).toContain('SEMANA_PERFECTA');
  });

  it('awards MES_PERFECTO at 30 days', () => {
    const a = s.checkAchievements({ currentStreak: 30, totalDays: 30, longestStreak: 30 } as any);
    expect(a).toContain('MES_PERFECTO');
  });

  it('awards CENTURION at 100 days', () => {
    const a = s.checkAchievements({ currentStreak: 100, totalDays: 100, longestStreak: 100 } as any);
    expect(a).toContain('CENTURION');
  });

  it('returns default for new user', async () => {
    const streak = await s.getStreak('u1');
    expect(streak.currentStreak).toBe(0);
  });
});
