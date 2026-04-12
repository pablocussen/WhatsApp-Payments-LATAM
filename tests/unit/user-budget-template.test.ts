const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserBudgetTemplateService } from '../../src/services/user-budget-template.service';

describe('UserBudgetTemplateService', () => {
  let s: UserBudgetTemplateService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserBudgetTemplateService(); mockRedisGet.mockResolvedValue(null); });

  it('creates default 50/30/20 template', async () => {
    const t = await s.createTemplate({ userId: 'u1', name: 'Mi presupuesto', monthlyIncome: 1000000 });
    expect(t.id).toMatch(/^btpl_/);
    expect(t.categories).toHaveLength(3);
    expect(t.categories[0].amount).toBe(500000);
    expect(t.categories[1].amount).toBe(300000);
    expect(t.categories[2].amount).toBe(200000);
    expect(t.savingsGoal).toBe(200000);
  });

  it('creates custom template', async () => {
    const t = await s.createTemplate({
      userId: 'u1', name: 'Custom', monthlyIncome: 1000000,
      categories: [
        { category: 'ARRIENDO', amount: 0, percentage: 40 },
        { category: 'COMIDA', amount: 0, percentage: 30 },
        { category: 'OTROS', amount: 0, percentage: 30 },
      ],
    });
    expect(t.categories[0].amount).toBe(400000);
  });

  it('rejects low income', async () => {
    await expect(s.createTemplate({ userId: 'u1', name: 'X', monthlyIncome: 50000 }))
      .rejects.toThrow('100.000');
  });

  it('rejects categories not summing 100', async () => {
    await expect(s.createTemplate({
      userId: 'u1', name: 'X', monthlyIncome: 1000000,
      categories: [
        { category: 'A', amount: 0, percentage: 40 },
        { category: 'B', amount: 0, percentage: 40 },
      ],
    })).rejects.toThrow('100%');
  });

  it('returns null for missing', async () => {
    expect(await s.getTemplate('nope')).toBeNull();
  });

  it('formats summary', async () => {
    const t = await s.createTemplate({ userId: 'u1', name: 'Test', monthlyIncome: 1000000 });
    const f = s.formatTemplateSummary(t);
    expect(f).toContain('Test');
    expect(f).toContain('$1.000.000');
    expect(f).toContain('NECESIDADES');
    expect(f).toContain('50%');
  });
});
