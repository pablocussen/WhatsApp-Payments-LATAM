const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserFinancialWellnessService } from '../../src/services/user-financial-wellness.service';

describe('UserFinancialWellnessService', () => {
  let s: UserFinancialWellnessService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserFinancialWellnessService(); mockRedisGet.mockResolvedValue(null); });

  it('returns null for missing user', async () => {
    expect(await s.get('u1')).toBeNull();
  });

  it('rejects negative values', async () => {
    await expect(s.update({ userId: 'u1', monthlyIncome: -100, monthlyExpenses: 0, savingsBalance: 0, debtBalance: 0 })).rejects.toThrow('negativos');
  });

  it('computes excellent grade A', async () => {
    const snap = await s.update({ userId: 'u1', monthlyIncome: 2000000, monthlyExpenses: 1000000, savingsBalance: 10000000, debtBalance: 0 });
    expect(snap.grade).toBe('A');
    expect(snap.wellnessScore).toBeGreaterThanOrEqual(85);
  });

  it('computes failing grade F with high debt and no savings', async () => {
    const snap = await s.update({ userId: 'u1', monthlyIncome: 500000, monthlyExpenses: 500000, savingsBalance: 0, debtBalance: 10000000 });
    expect(snap.grade).toBe('F');
  });

  it('computes savings rate', async () => {
    const snap = await s.update({ userId: 'u1', monthlyIncome: 1000000, monthlyExpenses: 800000, savingsBalance: 500000, debtBalance: 0 });
    expect(snap.savingsRate).toBe(20);
  });

  it('computes emergency fund months', async () => {
    const snap = await s.update({ userId: 'u1', monthlyIncome: 1000000, monthlyExpenses: 500000, savingsBalance: 3000000, debtBalance: 0 });
    expect(snap.emergencyFundMonths).toBe(6);
  });

  it('computes debt to income ratio', async () => {
    const snap = await s.update({ userId: 'u1', monthlyIncome: 1000000, monthlyExpenses: 500000, savingsBalance: 0, debtBalance: 3000000 });
    expect(snap.debtToIncomeRatio).toBe(25);
  });

  it('handles zero income gracefully', async () => {
    const snap = await s.update({ userId: 'u1', monthlyIncome: 0, monthlyExpenses: 500000, savingsBalance: 1000000, debtBalance: 0 });
    expect(snap.savingsRate).toBe(0);
    expect(snap.debtToIncomeRatio).toBe(0);
  });

  it('recommends emergency fund when insufficient', async () => {
    const snap = await s.update({ userId: 'u1', monthlyIncome: 1000000, monthlyExpenses: 800000, savingsBalance: 500000, debtBalance: 0 });
    expect(snap.recommendations.some(r => r.includes('emergencia'))).toBe(true);
  });

  it('recommends investing when excellent', async () => {
    const snap = await s.update({ userId: 'u1', monthlyIncome: 2000000, monthlyExpenses: 1000000, savingsBalance: 15000000, debtBalance: 0 });
    expect(snap.recommendations.some(r => r.includes('invertir'))).toBe(true);
  });

  it('formats report with all sections', () => {
    const snap = {
      userId: 'u1', monthlyIncome: 1000000, monthlyExpenses: 700000,
      savingsBalance: 3000000, debtBalance: 0, emergencyFundMonths: 4.3,
      savingsRate: 30, debtToIncomeRatio: 0, wellnessScore: 82, grade: 'B' as const,
      updatedAt: '', recommendations: ['Test recommendation'],
    };
    const f = s.formatReport(snap);
    expect(f).toContain('Score: 82');
    expect(f).toContain('Grade B');
    expect(f).toContain('Test recommendation');
  });

  it('retrieves saved snapshot', async () => {
    const saved = { userId: 'u1', wellnessScore: 75, grade: 'B' };
    mockRedisGet.mockResolvedValue(JSON.stringify(saved));
    const got = await s.get('u1');
    expect(got?.wellnessScore).toBe(75);
  });
});
