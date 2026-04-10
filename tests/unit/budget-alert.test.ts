/**
 * BudgetAlertService — spending budgets with alerts.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { BudgetAlertService } from '../../src/services/budget-alert.service';

describe('BudgetAlertService', () => {
  let service: BudgetAlertService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BudgetAlertService();
    mockRedisGet.mockResolvedValue(null);
  });

  // ── createBudget ──────────────────────────────────

  it('creates a budget', async () => {
    const b = await service.createBudget({
      userId: 'u1', name: 'Comida', period: 'MONTHLY', limitAmount: 100000,
    });
    expect(b.id).toMatch(/^bgt_/);
    expect(b.name).toBe('Comida');
    expect(b.limitAmount).toBe(100000);
    expect(b.spentAmount).toBe(0);
    expect(b.alertAt).toBe(80);
    expect(b.enabled).toBe(true);
  });

  it('rejects empty name', async () => {
    await expect(service.createBudget({ userId: 'u1', name: '', period: 'DAILY', limitAmount: 5000 }))
      .rejects.toThrow('Nombre');
  });

  it('rejects limit below 1000', async () => {
    await expect(service.createBudget({ userId: 'u1', name: 'Test', period: 'DAILY', limitAmount: 500 }))
      .rejects.toThrow('1.000');
  });

  it('rejects over 10 budgets', async () => {
    const existing = Array.from({ length: 10 }, (_, i) => ({ id: `bgt_${i}`, userId: 'u1', name: `B${i}` }));
    mockRedisGet.mockResolvedValue(JSON.stringify(existing));
    await expect(service.createBudget({ userId: 'u1', name: 'Extra', period: 'MONTHLY', limitAmount: 5000 }))
      .rejects.toThrow('10');
  });

  it('uses custom alertAt', async () => {
    const b = await service.createBudget({
      userId: 'u1', name: 'Transporte', period: 'WEEKLY', limitAmount: 50000, alertAt: 90,
    });
    expect(b.alertAt).toBe(90);
  });

  // ── getBudgets ────────────────────────────────────

  it('returns empty for new user', async () => {
    expect(await service.getBudgets('u1')).toEqual([]);
  });

  it('returns stored budgets', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'bgt_1', name: 'A' }]));
    const budgets = await service.getBudgets('u1');
    expect(budgets).toHaveLength(1);
  });

  // ── recordSpending ────────────────────────────────

  it('tracks spending', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'bgt_1', userId: 'u1', name: 'Comida', limitAmount: 100000, spentAmount: 0, alertAt: 80, alerted: false, enabled: true },
    ]));
    const triggered = await service.recordSpending('u1', 50000);
    expect(triggered).toHaveLength(0);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].spentAmount).toBe(50000);
  });

  it('triggers alert at threshold', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'bgt_1', userId: 'u1', name: 'Comida', limitAmount: 100000, spentAmount: 70000, alertAt: 80, alerted: false, enabled: true },
    ]));
    const triggered = await service.recordSpending('u1', 15000);
    expect(triggered).toHaveLength(1);
    expect(triggered[0].id).toBe('bgt_1');
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].alerted).toBe(true);
  });

  it('does not re-trigger', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'bgt_1', userId: 'u1', name: 'Comida', limitAmount: 100000, spentAmount: 90000, alertAt: 80, alerted: true, enabled: true },
    ]));
    const triggered = await service.recordSpending('u1', 5000);
    expect(triggered).toHaveLength(0);
  });

  it('skips disabled budgets', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'bgt_1', userId: 'u1', name: 'Off', limitAmount: 1000, spentAmount: 0, alertAt: 80, alerted: false, enabled: false },
    ]));
    const triggered = await service.recordSpending('u1', 5000);
    expect(triggered).toHaveLength(0);
  });

  // ── resetBudget ───────────────────────────────────

  it('resets spending and alert', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'bgt_1', userId: 'u1', spentAmount: 80000, alerted: true },
    ]));
    const result = await service.resetBudget('u1', 'bgt_1');
    expect(result).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].spentAmount).toBe(0);
    expect(saved[0].alerted).toBe(false);
  });

  it('returns false for non-existent budget', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([]));
    expect(await service.resetBudget('u1', 'bgt_nonexistent')).toBe(false);
  });

  // ── deleteBudget ──────────────────────────────────

  it('deletes a budget', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'bgt_1' }, { id: 'bgt_2' },
    ]));
    expect(await service.deleteBudget('u1', 'bgt_1')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe('bgt_2');
  });

  // ── getBudgetSummary ──────────────────────────────

  it('formats budget summary', () => {
    const summary = service.getBudgetSummary({
      id: 'bgt_1', userId: 'u1', name: 'Comida', period: 'MONTHLY',
      limitAmount: 100000, spentAmount: 65000, alertAt: 80, alerted: false, enabled: true, createdAt: '',
    });
    expect(summary).toContain('Comida');
    expect(summary).toContain('$65.000');
    expect(summary).toContain('$100.000');
    expect(summary).toContain('65%');
    expect(summary).toContain('$35.000');
  });

  it('shows 0 remaining when over budget', () => {
    const summary = service.getBudgetSummary({
      id: 'bgt_1', userId: 'u1', name: 'Test', period: 'DAILY',
      limitAmount: 10000, spentAmount: 15000, alertAt: 80, alerted: true, enabled: true, createdAt: '',
    });
    expect(summary).toContain('150%');
    expect(summary).toContain('$0');
  });
});
