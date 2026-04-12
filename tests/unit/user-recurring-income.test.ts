const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserRecurringIncomeService } from '../../src/services/user-recurring-income.service';

describe('UserRecurringIncomeService', () => {
  let s: UserRecurringIncomeService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserRecurringIncomeService(); mockRedisGet.mockResolvedValue(null); });

  it('creates monthly income', async () => {
    const i = await s.createIncome({ userId: 'u1', source: 'SALARY', description: 'Sueldo', amount: 800000, frequency: 'MONTHLY' });
    expect(i.id).toMatch(/^rinc_/);
    expect(i.frequency).toBe('MONTHLY');
    expect(i.active).toBe(true);
  });

  it('rejects low amount', async () => {
    await expect(s.createIncome({ userId: 'u1', source: 'OTHER', description: 'X', amount: 500, frequency: 'MONTHLY' })).rejects.toThrow('1.000');
  });

  it('records received advances next date', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'i1', active: true, amount: 500000, frequency: 'MONTHLY', totalReceived: 0 }]));
    expect(await s.recordReceived('u1', 'i1')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].totalReceived).toBe(500000);
  });

  it('calculates monthly total (weekly x4)', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { active: true, amount: 100000, frequency: 'WEEKLY' },
      { active: true, amount: 500000, frequency: 'MONTHLY' },
    ]));
    expect(await s.getMonthlyTotal('u1')).toBe(900000);
  });

  it('calculates monthly total (biweekly x2)', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { active: true, amount: 300000, frequency: 'BIWEEKLY' },
    ]));
    expect(await s.getMonthlyTotal('u1')).toBe(600000);
  });

  it('ignores inactive in total', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { active: true, amount: 500000, frequency: 'MONTHLY' },
      { active: false, amount: 300000, frequency: 'MONTHLY' },
    ]));
    expect(await s.getMonthlyTotal('u1')).toBe(500000);
  });

  it('deactivates income', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'i1', active: true }]));
    expect(await s.deactivate('u1', 'i1')).toBe(true);
  });

  it('formats summary', () => {
    const f = s.formatIncomeSummary({ description: 'Sueldo', amount: 800000, frequency: 'MONTHLY', source: 'SALARY' } as any);
    expect(f).toContain('Sueldo');
    expect(f).toContain('$800.000');
    expect(f).toContain('SALARY');
  });
});
