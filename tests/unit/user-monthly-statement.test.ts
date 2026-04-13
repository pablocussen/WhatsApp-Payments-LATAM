const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserMonthlyStatementService } from '../../src/services/user-monthly-statement.service';

describe('UserMonthlyStatementService', () => {
  let s: UserMonthlyStatementService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserMonthlyStatementService(); mockRedisGet.mockResolvedValue(null); });

  const lineItems = [
    { date: '2026-04-01', description: 'Sueldo', category: 'Income', amount: 1500000, type: 'CREDIT' as const },
    { date: '2026-04-05', description: 'Arriendo', category: 'Housing', amount: 500000, type: 'DEBIT' as const },
    { date: '2026-04-10', description: 'Supermercado', category: 'Food', amount: 120000, type: 'DEBIT' as const },
  ];

  it('generates statement with totals', async () => {
    const stmt = await s.generate({ userId: 'u1', year: 2026, month: 3, openingBalance: 200000, lineItems });
    expect(stmt.totalCredits).toBe(1500000);
    expect(stmt.totalDebits).toBe(620000);
    expect(stmt.closingBalance).toBe(1080000);
    expect(stmt.transactionCount).toBe(3);
    expect(stmt.status).toBe('READY');
  });

  it('rejects invalid month', async () => {
    await expect(s.generate({ userId: 'u1', year: 2026, month: 13, openingBalance: 0, lineItems: [] })).rejects.toThrow('0 y 11');
  });

  it('rejects negative opening balance', async () => {
    await expect(s.generate({ userId: 'u1', year: 2026, month: 3, openingBalance: -100, lineItems: [] })).rejects.toThrow('negativo');
  });

  it('rejects duplicate period', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ year: 2026, month: 3 }]));
    await expect(s.generate({ userId: 'u1', year: 2026, month: 3, openingBalance: 0, lineItems: [] })).rejects.toThrow('Ya existe');
  });

  it('retrieves statement by period', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 's1', year: 2026, month: 3 },
      { id: 's2', year: 2026, month: 2 },
    ]));
    const stmt = await s.get('u1', 2026, 3);
    expect(stmt?.id).toBe('s1');
  });

  it('sets download url', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 's1' }]));
    const stmt = await s.setDownloadUrl('u1', 's1', 'https://cdn.whatpay.cl/stmt/123.pdf');
    expect(stmt?.downloadUrl).toContain('whatpay.cl');
  });

  it('rejects invalid url', async () => {
    await expect(s.setDownloadUrl('u1', 's1', 'file://local')).rejects.toThrow('URL');
  });

  it('groups by category', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      year: 2026, month: 3,
      lineItems,
    }]));
    const cats = await s.getByCategory('u1', 2026, 3);
    expect(cats['Housing'].debits).toBe(500000);
    expect(cats['Income'].credits).toBe(1500000);
    expect(cats['Food'].debits).toBe(120000);
  });

  it('computes year summary', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { year: 2026, month: 0, totalCredits: 1500000, totalDebits: 500000 },
      { year: 2026, month: 1, totalCredits: 1500000, totalDebits: 800000 },
      { year: 2025, month: 11, totalCredits: 9999999, totalDebits: 0 },
    ]));
    const summary = await s.getYearSummary('u1', 2026);
    expect(summary.totalCredits).toBe(3000000);
    expect(summary.totalDebits).toBe(1300000);
    expect(summary.net).toBe(1700000);
    expect(summary.months).toBe(2);
  });

  it('keeps only last 24 statements', async () => {
    const existing = Array.from({ length: 24 }, (_, i) => ({ year: 2024, month: i % 12, totalCredits: 0, totalDebits: 0 }));
    mockRedisGet.mockResolvedValue(JSON.stringify(existing));
    await s.generate({ userId: 'u1', year: 2026, month: 5, openingBalance: 0, lineItems: [] });
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved).toHaveLength(24);
    expect(saved[saved.length - 1].year).toBe(2026);
  });
});
