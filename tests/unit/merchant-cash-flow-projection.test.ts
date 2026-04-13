const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantCashFlowProjectionService } from '../../src/services/merchant-cash-flow-projection.service';

describe('MerchantCashFlowProjectionService', () => {
  let s: MerchantCashFlowProjectionService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantCashFlowProjectionService(); mockRedisGet.mockResolvedValue(null); });

  it('adds entry', async () => {
    const e = await s.addEntry({ merchantId: 'm1', type: 'INCOME', category: 'Ventas', amount: 500000, date: new Date().toISOString() });
    expect(e.type).toBe('INCOME');
  });

  it('rejects zero amount', async () => {
    await expect(s.addEntry({ merchantId: 'm1', type: 'INCOME', category: 'x', amount: 0, date: new Date().toISOString() })).rejects.toThrow('positivo');
  });

  it('rejects recurring without interval', async () => {
    await expect(s.addEntry({ merchantId: 'm1', type: 'INCOME', category: 'x', amount: 100, date: new Date().toISOString(), recurring: true })).rejects.toThrow('intervalo');
  });

  it('removes entry', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'e1' }, { id: 'e2' }]));
    expect(await s.removeEntry('m1', 'e1')).toBe(true);
  });

  it('projects income and expense for 30 days', async () => {
    const inFive = new Date(Date.now() + 5 * 86400000).toISOString();
    const inTen = new Date(Date.now() + 10 * 86400000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'e1', type: 'INCOME', category: 'Ventas', amount: 1000000, date: inFive, recurring: false },
      { id: 'e2', type: 'EXPENSE', category: 'Arriendo', amount: 300000, date: inTen, recurring: false },
    ]));
    const p = await s.project('m1', 30, 500000);
    expect(p.expectedIncome).toBe(1000000);
    expect(p.expectedExpense).toBe(300000);
    expect(p.netCashFlow).toBe(700000);
    expect(p.endingBalance).toBe(1200000);
  });

  it('projects recurring entries', async () => {
    const today = new Date().toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'e1', type: 'EXPENSE', category: 'Sueldos', amount: 100000, date: today, recurring: true, recurringInterval: 'WEEKLY' },
    ]));
    const p = await s.project('m1', 28, 1000000);
    expect(p.expectedExpense).toBeGreaterThanOrEqual(400000);
  });

  it('excludes entries outside window', async () => {
    const farFuture = new Date(Date.now() + 100 * 86400000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'e1', type: 'INCOME', amount: 5000000, date: farFuture, recurring: false },
    ]));
    const p = await s.project('m1', 30, 0);
    expect(p.expectedIncome).toBe(0);
  });

  it('rejects invalid days', async () => {
    await expect(s.project('m1', 0, 0)).rejects.toThrow('1 y 365');
    await expect(s.project('m1', 500, 0)).rejects.toThrow('1 y 365');
  });

  it('groups by category', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { type: 'EXPENSE', category: 'Arriendo', amount: 300000 },
      { type: 'EXPENSE', category: 'Sueldos', amount: 800000 },
      { type: 'EXPENSE', category: 'Arriendo', amount: 50000 },
      { type: 'INCOME', category: 'Ventas', amount: 2000000 },
    ]));
    const cats = await s.getByCategory('m1', 'EXPENSE');
    expect(cats['Arriendo']).toBe(350000);
    expect(cats['Sueldos']).toBe(800000);
    expect(cats['Ventas']).toBeUndefined();
  });

  it('computes runway in months', async () => {
    const today = new Date().toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { type: 'EXPENSE', amount: 500000, date: today, recurring: true, recurringInterval: 'MONTHLY' },
      { type: 'INCOME', amount: 200000, date: today, recurring: true, recurringInterval: 'MONTHLY' },
    ]));
    const runway = await s.getRunway('m1', 3000000);
    expect(runway).toBe(10);
  });

  it('returns Infinity runway when income covers expenses', async () => {
    const today = new Date().toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { type: 'INCOME', amount: 1000000, date: today, recurring: true, recurringInterval: 'MONTHLY' },
      { type: 'EXPENSE', amount: 500000, date: today, recurring: true, recurringInterval: 'MONTHLY' },
    ]));
    expect(await s.getRunway('m1', 1000000)).toBe(Infinity);
  });
});
