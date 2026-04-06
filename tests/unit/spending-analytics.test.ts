/**
 * SpendingAnalyticsService — user spending insights.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisIncr = jest.fn().mockResolvedValue(1);
const mockRedisIncrBy = jest.fn().mockResolvedValue(1);
const mockRedisExpire = jest.fn().mockResolvedValue(true);

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    incr: (...args: unknown[]) => mockRedisIncr(...args),
    incrBy: (...args: unknown[]) => mockRedisIncrBy(...args),
    expire: (...args: unknown[]) => mockRedisExpire(...args),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { SpendingAnalyticsService } from '../../src/services/spending-analytics.service';

describe('SpendingAnalyticsService', () => {
  let service: SpendingAnalyticsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SpendingAnalyticsService();
    mockRedisGet.mockResolvedValue(null);
  });

  // ── recordSpend ───────────────────────────────────

  it('increments spent counter for sent type', async () => {
    await service.recordSpend('user-1', 5000, 'sent');
    expect(mockRedisIncrBy).toHaveBeenCalledWith(expect.stringContaining(':spent'), 5000);
    expect(mockRedisIncr).toHaveBeenCalledWith(expect.stringContaining(':tx_count'));
  });

  it('increments received counter for received type', async () => {
    await service.recordSpend('user-1', 3000, 'received');
    expect(mockRedisIncrBy).toHaveBeenCalledWith(expect.stringContaining(':received'), 3000);
  });

  it('tracks day of week', async () => {
    await service.recordSpend('user-1', 5000, 'sent');
    const dow = new Date().getDay();
    expect(mockRedisIncrBy).toHaveBeenCalledWith(expect.stringContaining(`:dow:${dow}:amount`), 5000);
  });

  it('tracks largest transaction', async () => {
    mockRedisGet.mockResolvedValue(null); // no existing largest
    await service.recordSpend('user-1', 15000, 'sent');
    expect(mockRedisSet).toHaveBeenCalledWith(expect.stringContaining(':largest'), '15000');
  });

  // ── getInsights ───────────────────────────────────

  it('returns zero insights for new user', async () => {
    const insights = await service.getInsights('user-1');
    expect(insights.totalSpent).toBe(0);
    expect(insights.totalReceived).toBe(0);
    expect(insights.transactionCount).toBe(0);
    expect(insights.averageTransaction).toBe(0);
  });

  it('calculates correct averages', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.includes(':spent')) return Promise.resolve('30000');
      if (key.includes(':tx_count')) return Promise.resolve('3');
      if (key.includes(':received')) return Promise.resolve('10000');
      if (key.includes(':largest')) return Promise.resolve('15000');
      return Promise.resolve(null);
    });

    const insights = await service.getInsights('user-1');
    expect(insights.totalSpent).toBe(30000);
    expect(insights.totalSpentFormatted).toBe('$30.000');
    expect(insights.averageTransaction).toBe(10000);
    expect(insights.largestTransaction).toBe(15000);
    expect(insights.transactionCount).toBe(3);
  });

  it('calculates net flow', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.includes(':spent')) return Promise.resolve('50000');
      if (key.includes(':received')) return Promise.resolve('30000');
      return Promise.resolve(null);
    });

    const insights = await service.getInsights('user-1');
    expect(insights.netFlow).toBe(-20000);
    expect(insights.netFlowFormatted).toContain('$20.000');
  });

  it('returns 7 days in byDayOfWeek', async () => {
    const insights = await service.getInsights('user-1');
    expect(insights.byDayOfWeek).toHaveLength(7);
    expect(insights.byDayOfWeek[0].day).toBe('Domingo');
    expect(insights.byDayOfWeek[6].day).toBe('Sabado');
  });

  it('uses current month by default', async () => {
    const insights = await service.getInsights('user-1');
    expect(insights.period).toMatch(/^\d{4}-\d{2}$/);
  });

  it('accepts custom month', async () => {
    const insights = await service.getInsights('user-1', '2026-03');
    expect(insights.period).toBe('2026-03');
  });

  it('positive net flow shows + sign', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.includes(':spent')) return Promise.resolve('10000');
      if (key.includes(':received')) return Promise.resolve('50000');
      return Promise.resolve(null);
    });

    const insights = await service.getInsights('user-1');
    expect(insights.netFlow).toBe(40000);
    expect(insights.netFlowFormatted).toContain('+');
  });
});
