const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserSpendingGoalService } from '../../src/services/user-spending-goal.service';

describe('UserSpendingGoalService', () => {
  let s: UserSpendingGoalService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserSpendingGoalService(); mockRedisGet.mockResolvedValue(null); });

  it('creates weekly goal', async () => {
    const g = await s.createGoal({ userId: 'u1', category: 'FOOD', maxAmount: 50000, period: 'WEEK' });
    expect(g.id).toMatch(/^spg_/);
    expect(g.period).toBe('WEEK');
    expect(g.currentSpent).toBe(0);
  });

  it('creates monthly goal', async () => {
    const g = await s.createGoal({ userId: 'u1', category: 'TRANSPORT', maxAmount: 100000, period: 'MONTH' });
    expect(g.period).toBe('MONTH');
  });

  it('rejects below 1000', async () => {
    await expect(s.createGoal({ userId: 'u1', category: 'X', maxAmount: 500, period: 'WEEK' })).rejects.toThrow('1.000');
  });

  it('adds spending under limit', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'g1', active: true, currentSpent: 10000, maxAmount: 50000 }));
    const r = await s.addSpending('g1', 20000);
    expect(r.overLimit).toBe(false);
    expect(r.percentUsed).toBe(60);
  });

  it('detects over limit', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'g1', active: true, currentSpent: 40000, maxAmount: 50000 }));
    const r = await s.addSpending('g1', 20000);
    expect(r.overLimit).toBe(true);
    expect(r.percentUsed).toBe(120);
  });

  it('ignores inactive goal', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'g1', active: false }));
    const r = await s.addSpending('g1', 10000);
    expect(r.percentUsed).toBe(0);
  });

  it('deactivates goal', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'g1', active: true }));
    expect(await s.deactivate('g1')).toBe(true);
  });

  it('formats summary', () => {
    const f = s.formatGoalSummary({ category: 'FOOD', currentSpent: 30000, maxAmount: 50000, period: 'WEEK' } as any);
    expect(f).toContain('FOOD');
    expect(f).toContain('$30.000');
    expect(f).toContain('60%');
  });
});
