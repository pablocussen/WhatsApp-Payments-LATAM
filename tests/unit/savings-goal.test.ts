const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }),
}));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { SavingsGoalService } from '../../src/services/savings-goal.service';

describe('SavingsGoalService', () => {
  let s: SavingsGoalService;
  beforeEach(() => { jest.clearAllMocks(); s = new SavingsGoalService(); mockRedisGet.mockResolvedValue(null); });

  it('creates goal', async () => { const g = await s.createGoal({ userId: 'u1', name: 'Vacaciones', targetAmount: 500000 }); expect(g.id).toMatch(/^goal_/); expect(g.currentAmount).toBe(0); expect(g.status).toBe('ACTIVE'); });
  it('rejects below 1000', async () => { await expect(s.createGoal({ userId: 'u1', name: 'X', targetAmount: 500 })).rejects.toThrow('1.000'); });
  it('rejects over 5 active', async () => {
    const goals = Array.from({ length: 5 }, (_, i) => ({ id: `g${i}`, status: 'ACTIVE' }));
    mockRedisGet.mockResolvedValue(JSON.stringify(goals));
    await expect(s.createGoal({ userId: 'u1', name: 'X', targetAmount: 5000 })).rejects.toThrow('5');
  });
  it('contributes to goal', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'g1', currentAmount: 100000, targetAmount: 500000, status: 'ACTIVE', contributions: 2 }]));
    const g = await s.contribute('u1', 'g1', 50000);
    expect(g?.currentAmount).toBe(150000);
    expect(g?.contributions).toBe(3);
  });
  it('auto-completes at target', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'g1', currentAmount: 450000, targetAmount: 500000, status: 'ACTIVE', contributions: 5 }]));
    const g = await s.contribute('u1', 'g1', 60000);
    expect(g?.status).toBe('COMPLETED');
    expect(g?.completedAt).toBeDefined();
  });
  it('withdraws from goal', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'g1', currentAmount: 200000, targetAmount: 500000, status: 'ACTIVE' }]));
    const g = await s.withdraw('u1', 'g1', 50000);
    expect(g?.currentAmount).toBe(150000);
  });
  it('rejects overdraft', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'g1', currentAmount: 10000, status: 'ACTIVE' }]));
    await expect(s.withdraw('u1', 'g1', 50000)).rejects.toThrow('insuficientes');
  });
  it('abandons goal', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'g1', status: 'ACTIVE' }]));
    expect(await s.abandonGoal('u1', 'g1')).toBe(true);
  });
  it('returns empty for new user', async () => { expect(await s.getGoals('u1')).toEqual([]); });
  it('calculates progress', () => {
    expect(s.getProgress({ currentAmount: 250000, targetAmount: 500000 } as any)).toBe(50);
    expect(s.getProgress({ currentAmount: 600000, targetAmount: 500000 } as any)).toBe(100);
  });
  it('formats with progress bar', () => {
    const f = s.formatGoalSummary({ name: 'Vacaciones', currentAmount: 250000, targetAmount: 500000 } as any);
    expect(f).toContain('Vacaciones');
    expect(f).toContain('$250.000');
    expect(f).toContain('$500.000');
    expect(f).toContain('50%');
    expect(f).toContain('█████░░░░░');
  });
});
