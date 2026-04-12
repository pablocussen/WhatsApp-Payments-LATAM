const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserAutoSaveService } from '../../src/services/user-auto-save.service';

describe('UserAutoSaveService', () => {
  let s: UserAutoSaveService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserAutoSaveService(); mockRedisGet.mockResolvedValue(null); });

  it('creates fixed amount rule', async () => {
    const r = await s.createRule({ userId: 'u1', name: 'Ahorro diario', type: 'FIXED_AMOUNT', amount: 1000 });
    expect(r.id).toMatch(/^asave_/);
    expect(r.amount).toBe(1000);
  });

  it('creates percent rule', async () => {
    const r = await s.createRule({ userId: 'u1', name: '10% ingresos', type: 'PERCENT_OF_INCOME', percent: 10 });
    expect(r.percent).toBe(10);
  });

  it('rejects low fixed amount', async () => {
    await expect(s.createRule({ userId: 'u1', name: 'X', type: 'FIXED_AMOUNT', amount: 50 })).rejects.toThrow('100');
  });

  it('rejects invalid percent', async () => {
    await expect(s.createRule({ userId: 'u1', name: 'X', type: 'PERCENT_OF_INCOME', percent: 60 })).rejects.toThrow('50');
  });

  it('rejects over 5 rules', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ id: 'r' + i }))));
    await expect(s.createRule({ userId: 'u1', name: 'X', type: 'FIXED_AMOUNT', amount: 1000 })).rejects.toThrow('5');
  });

  it('calculates fixed amount', () => {
    expect(s.calculateSaveAmount({ type: 'FIXED_AMOUNT', amount: 1000 } as any, 0)).toBe(1000);
  });

  it('calculates percent of income', () => {
    expect(s.calculateSaveAmount({ type: 'PERCENT_OF_INCOME', percent: 10 } as any, 0, 500000)).toBe(50000);
  });

  it('calculates round up', () => {
    expect(s.calculateSaveAmount({ type: 'ROUND_UP' } as any, 2500)).toBe(500);
    expect(s.calculateSaveAmount({ type: 'ROUND_UP' } as any, 2000)).toBe(0);
  });

  it('calculates spare change', () => {
    expect(s.calculateSaveAmount({ type: 'SPARE_CHANGE' } as any, 2750)).toBe(750);
  });

  it('records save', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'r1', active: true, totalSaved: 5000, savesCount: 3 }]));
    expect(await s.recordSave('u1', 'r1', 500)).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].totalSaved).toBe(5500);
    expect(saved[0].savesCount).toBe(4);
  });

  it('deactivates rule', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'r1', active: true }]));
    expect(await s.deactivate('u1', 'r1')).toBe(true);
  });

  it('formats summary', () => {
    const f = s.formatRuleSummary({ name: 'Round up', type: 'ROUND_UP', totalSaved: 25000, savesCount: 15 } as any);
    expect(f).toContain('Round up');
    expect(f).toContain('$25.000');
    expect(f).toContain('15');
  });
});
