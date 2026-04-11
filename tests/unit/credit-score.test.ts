/**
 * CreditScoreService — scoring crediticio basado en historial.
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

import { CreditScoreService } from '../../src/services/credit-score.service';

describe('CreditScoreService', () => {
  let service: CreditScoreService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new CreditScoreService();
    mockRedisGet.mockResolvedValue(null);
  });

  it('calculates excellent score', async () => {
    const score = await service.calculateScore('u1', {
      totalTransactions: 250, monthsActive: 24, onTimePayments: 200,
      totalPayments: 200, kycLevel: 'FULL', openDisputes: 0,
      resolvedDisputes: 0, avgMonthlyVolume: 500000,
    });
    expect(score.score).toBeGreaterThanOrEqual(80);
    expect(score.rating).toBe('EXCELLENT');
    expect(score.maxLoanAmount).toBe(1500000); // 500K * 3
  });

  it('calculates good score', async () => {
    const score = await service.calculateScore('u1', {
      totalTransactions: 100, monthsActive: 12, onTimePayments: 90,
      totalPayments: 100, kycLevel: 'INTERMEDIATE', openDisputes: 0,
      resolvedDisputes: 1, avgMonthlyVolume: 300000,
    });
    expect(score.score).toBeGreaterThanOrEqual(60);
    expect(score.rating).toBe('GOOD');
  });

  it('calculates poor score for new user', async () => {
    const score = await service.calculateScore('u1', {
      totalTransactions: 3, monthsActive: 1, onTimePayments: 2,
      totalPayments: 3, kycLevel: 'BASIC', openDisputes: 1,
      resolvedDisputes: 0, avgMonthlyVolume: 50000,
    });
    expect(score.score).toBeLessThan(40);
    expect(score.maxLoanAmount).toBe(0);
  });

  it('returns cached score', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ userId: 'u1', score: 75, rating: 'GOOD' }));
    const score = await service.getScore('u1');
    expect(score?.score).toBe(75);
  });

  it('returns null for no cache', async () => {
    expect(await service.getScore('u1')).toBeNull();
  });

  it('rates correctly', () => {
    expect(service.getRating(85)).toBe('EXCELLENT');
    expect(service.getRating(65)).toBe('GOOD');
    expect(service.getRating(45)).toBe('FAIR');
    expect(service.getRating(25)).toBe('POOR');
    expect(service.getRating(10)).toBe('INSUFFICIENT');
  });

  it('labels in Spanish', () => {
    expect(service.getRatingLabel('EXCELLENT')).toBe('Excelente');
    expect(service.getRatingLabel('POOR')).toBe('Bajo');
  });

  it('max loan scales with score', async () => {
    const excellent = await service.calculateScore('u1', {
      totalTransactions: 250, monthsActive: 24, onTimePayments: 200,
      totalPayments: 200, kycLevel: 'FULL', openDisputes: 0,
      resolvedDisputes: 0, avgMonthlyVolume: 1000000,
    });
    expect(excellent.maxLoanAmount).toBe(3000000); // 1M * 3

    const good = await service.calculateScore('u2', {
      totalTransactions: 100, monthsActive: 12, onTimePayments: 90,
      totalPayments: 100, kycLevel: 'INTERMEDIATE', openDisputes: 0,
      resolvedDisputes: 1, avgMonthlyVolume: 1000000,
    });
    expect(good.maxLoanAmount).toBe(2000000); // 1M * 2
  });

  it('disputes reduce score', async () => {
    const clean = await service.calculateScore('u1', {
      totalTransactions: 50, monthsActive: 6, onTimePayments: 50,
      totalPayments: 50, kycLevel: 'INTERMEDIATE', openDisputes: 0,
      resolvedDisputes: 0, avgMonthlyVolume: 200000,
    });
    const disputed = await service.calculateScore('u2', {
      totalTransactions: 50, monthsActive: 6, onTimePayments: 50,
      totalPayments: 50, kycLevel: 'INTERMEDIATE', openDisputes: 2,
      resolvedDisputes: 3, avgMonthlyVolume: 200000,
    });
    expect(clean.score).toBeGreaterThan(disputed.score);
  });

  it('score capped at 100', async () => {
    const score = await service.calculateScore('u1', {
      totalTransactions: 500, monthsActive: 36, onTimePayments: 500,
      totalPayments: 500, kycLevel: 'FULL', openDisputes: 0,
      resolvedDisputes: 0, avgMonthlyVolume: 2000000,
    });
    expect(score.score).toBeLessThanOrEqual(100);
  });
});
