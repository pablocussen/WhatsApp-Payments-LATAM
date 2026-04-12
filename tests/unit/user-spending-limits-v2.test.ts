const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserSpendingLimitsV2Service } from '../../src/services/user-spending-limits-v2.service';

describe('UserSpendingLimitsV2Service', () => {
  let s: UserSpendingLimitsV2Service;
  beforeEach(() => { jest.clearAllMocks(); s = new UserSpendingLimitsV2Service(); mockRedisGet.mockResolvedValue(null); });

  it('returns defaults', async () => {
    const l = await s.getLimits('u1');
    expect(l.daily).toBe(500000);
    expect(l.monthly).toBe(5000000);
    expect(l.usedToday).toBe(0);
  });

  it('updates limits', async () => {
    const l = await s.updateLimits('u1', { daily: 100000, weekly: 500000 });
    expect(l.daily).toBe(100000);
    expect(l.weekly).toBe(500000);
  });

  it('rejects negative limit', async () => {
    await expect(s.updateLimits('u1', { daily: -1 })).rejects.toThrow('negativo');
  });

  it('allows spending within limits', async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockRedisGet.mockResolvedValue(JSON.stringify({
      userId: 'u1', daily: 500000, weekly: 2000000, monthly: 5000000, perTransaction: 1000000,
      usedToday: 100000, usedWeek: 100000, usedMonth: 100000,
      lastResetDay: today, lastResetWeek: today, lastResetMonth: today.slice(0, 7),
    }));
    const r = await s.checkSpending('u1', 50000);
    expect(r.allowed).toBe(true);
  });

  it('rejects per-transaction limit', async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockRedisGet.mockResolvedValue(JSON.stringify({
      userId: 'u1', daily: 5000000, weekly: 5000000, monthly: 5000000, perTransaction: 100000,
      usedToday: 0, usedWeek: 0, usedMonth: 0,
      lastResetDay: today, lastResetWeek: today, lastResetMonth: today.slice(0, 7),
    }));
    const r = await s.checkSpending('u1', 200000);
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('por transaccion');
  });

  it('rejects daily limit', async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockRedisGet.mockResolvedValue(JSON.stringify({
      userId: 'u1', daily: 100000, weekly: 1000000, monthly: 5000000, perTransaction: 200000,
      usedToday: 90000, usedWeek: 0, usedMonth: 0,
      lastResetDay: today, lastResetWeek: today, lastResetMonth: today.slice(0, 7),
    }));
    const r = await s.checkSpending('u1', 50000);
    expect(r.reason).toContain('diario');
  });

  it('records spending', async () => {
    const today = new Date().toISOString().slice(0, 10);
    mockRedisGet.mockResolvedValue(JSON.stringify({
      userId: 'u1', daily: 500000, weekly: 2000000, monthly: 5000000, perTransaction: 1000000,
      usedToday: 0, usedWeek: 0, usedMonth: 0,
      lastResetDay: today, lastResetWeek: today, lastResetMonth: today.slice(0, 7),
    }));
    const l = await s.recordSpending('u1', 50000);
    expect(l.usedToday).toBe(50000);
    expect(l.usedWeek).toBe(50000);
    expect(l.usedMonth).toBe(50000);
  });

  it('resets daily counter on new day', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      userId: 'u1', daily: 500000, weekly: 2000000, monthly: 5000000, perTransaction: 1000000,
      usedToday: 400000, usedWeek: 400000, usedMonth: 400000,
      lastResetDay: '2020-01-01', lastResetWeek: '2020-01-01', lastResetMonth: '2020-01',
    }));
    const l = await s.getLimits('u1');
    expect(l.usedToday).toBe(0);
    expect(l.usedWeek).toBe(0);
    expect(l.usedMonth).toBe(0);
  });
});
