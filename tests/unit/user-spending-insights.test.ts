const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserSpendingInsightsService } from '../../src/services/user-spending-insights.service';

describe('UserSpendingInsightsService', () => {
  let s: UserSpendingInsightsService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserSpendingInsightsService(); mockRedisGet.mockResolvedValue(null); });

  it('generates insights', async () => {
    const i = await s.generateInsights('u1', {
      transactions: [
        { amount: 5000, category: 'FOOD', recipient: '+569A' },
        { amount: 8000, category: 'FOOD', recipient: '+569A' },
        { amount: 3000, category: 'TRANSPORT', recipient: '+569B' },
      ],
      lastMonthTotal: 12000,
    });
    expect(i.totalSpent).toBe(16000);
    expect(i.topCategory).toBe('FOOD');
    expect(i.topCategoryAmount).toBe(13000);
    expect(i.biggestTransaction).toBe(8000);
    expect(i.mostFrequentRecipient).toBe('+569A');
    expect(i.transactionCount).toBe(3);
    expect(i.compareLastMonth).toBe(33);
  });
  it('handles empty transactions', async () => {
    const i = await s.generateInsights('u1', { transactions: [], lastMonthTotal: 0 });
    expect(i.totalSpent).toBe(0);
    expect(i.biggestTransaction).toBe(0);
    expect(i.mostFrequentRecipient).toBeNull();
  });
  it('handles zero last month', async () => {
    const i = await s.generateInsights('u1', {
      transactions: [{ amount: 5000, category: 'FOOD', recipient: '+569' }],
      lastMonthTotal: 0,
    });
    expect(i.compareLastMonth).toBe(0);
  });
  it('returns null for no insights', async () => { expect(await s.getInsights('u1')).toBeNull(); });
  it('returns stored insights', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ userId: 'u1', totalSpent: 50000 }));
    const i = await s.getInsights('u1');
    expect(i?.totalSpent).toBe(50000);
  });
  it('formats insight', () => {
    const f = s.formatInsight({
      userId: 'u1', period: '2026-04', totalSpent: 100000, avgDaily: 3333,
      topCategory: 'FOOD', topCategoryAmount: 50000, compareLastMonth: 20,
      biggestTransaction: 15000, mostFrequentRecipient: '+569', transactionCount: 20,
      generatedAt: '',
    });
    expect(f).toContain('$100.000');
    expect(f).toContain('20%');
    expect(f).toContain('mas');
    expect(f).toContain('FOOD');
  });
  it('formats with decrease', () => {
    const f = s.formatInsight({ compareLastMonth: -15, topCategory: 'X', topCategoryAmount: 0, totalSpent: 0, avgDaily: 0, biggestTransaction: 0 } as any);
    expect(f).toContain('menos');
  });
});
