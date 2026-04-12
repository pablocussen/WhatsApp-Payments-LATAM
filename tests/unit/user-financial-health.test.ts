const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserFinancialHealthService } from '../../src/services/user-financial-health.service';

describe('UserFinancialHealthService', () => {
  let s: UserFinancialHealthService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserFinancialHealthService(); mockRedisGet.mockResolvedValue(null); });

  it('calculates excellent score', () => {
    const score = s.calculateScore({
      monthlyIncome: 1000000, monthlySavings: 250000, monthlyExpenses: 500000,
      incomeVariability: 0, emergencyFund: 3000000, hasDebt: false,
    });
    expect(score.score).toBeGreaterThanOrEqual(85);
    expect(score.rating).toBe('EXCELLENT');
  });

  it('calculates poor score', () => {
    const score = s.calculateScore({
      monthlyIncome: 500000, monthlySavings: 0, monthlyExpenses: 480000,
      incomeVariability: 15, emergencyFund: 0, hasDebt: true,
    });
    expect(score.score).toBeLessThan(50);
  });

  it('rates correctly', () => {
    expect(s.getRating(90)).toBe('EXCELLENT');
    expect(s.getRating(75)).toBe('GOOD');
    expect(s.getRating(55)).toBe('FAIR');
    expect(s.getRating(35)).toBe('POOR');
    expect(s.getRating(20)).toBe('CRITICAL');
  });

  it('recommends emergency fund when low', () => {
    const recs = s.getRecommendations({
      monthlyIncome: 1000000, monthlySavings: 200000, monthlyExpenses: 500000,
      emergencyFund: 100000, hasDebt: false,
    }, 70);
    expect(recs.some(r => r.includes('emergencia'))).toBe(true);
  });

  it('recommends debt payoff', () => {
    const recs = s.getRecommendations({
      monthlyIncome: 500000, monthlySavings: 50000, monthlyExpenses: 300000,
      emergencyFund: 1000000, hasDebt: true,
    }, 60);
    expect(recs.some(r => r.includes('deudas'))).toBe(true);
  });

  it('saves score', async () => {
    const score = s.calculateScore({
      monthlyIncome: 800000, monthlySavings: 100000, monthlyExpenses: 500000,
      incomeVariability: 5, emergencyFund: 1500000, hasDebt: false,
    });
    await s.saveScore('u1', score);
    expect(mockRedisSet).toHaveBeenCalled();
  });

  it('returns null for missing', async () => {
    expect(await s.getScore('u1')).toBeNull();
  });
});
