const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantSalesGoalService } from '../../src/services/merchant-sales-goal.service';

describe('MerchantSalesGoalService', () => {
  let s: MerchantSalesGoalService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantSalesGoalService(); mockRedisGet.mockResolvedValue(null); });

  it('creates monthly goal', async () => {
    const g = await s.createGoal({ merchantId: 'm1', period: 'MONTHLY', targetAmount: 5000000 });
    expect(g.id).toMatch(/^sgoal_/);
    expect(g.currentAmount).toBe(0);
    expect(g.status).toBe('ACTIVE');
  });

  it('rejects below 10K', async () => {
    await expect(s.createGoal({ merchantId: 'm1', period: 'DAILY', targetAmount: 5000 })).rejects.toThrow('10.000');
  });

  it('adds sale progress', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'sgoal_1', status: 'ACTIVE', currentAmount: 100000, targetAmount: 500000 }));
    const g = await s.addSale('sgoal_1', 50000);
    expect(g?.currentAmount).toBe(150000);
    expect(g?.status).toBe('ACTIVE');
  });

  it('auto-achieves at target', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'sgoal_1', status: 'ACTIVE', currentAmount: 450000, targetAmount: 500000 }));
    const g = await s.addSale('sgoal_1', 60000);
    expect(g?.status).toBe('ACHIEVED');
    expect(g?.achievedAt).toBeDefined();
  });

  it('ignores sale on inactive goal', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'sgoal_1', status: 'ACHIEVED' }));
    expect(await s.addSale('sgoal_1', 10000)).toBeNull();
  });

  it('calculates progress', () => {
    expect(s.getProgress({ currentAmount: 250000, targetAmount: 500000 } as any)).toBe(50);
    expect(s.getProgress({ currentAmount: 600000, targetAmount: 500000 } as any)).toBe(100);
  });

  it('formats summary', () => {
    const f = s.formatGoalSummary({ period: 'MONTHLY', currentAmount: 300000, targetAmount: 500000 } as any);
    expect(f).toContain('$300.000');
    expect(f).toContain('60%');
    expect(f).toContain('$200.000');
  });
});
