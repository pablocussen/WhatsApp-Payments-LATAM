/**
 * PaymentLimitsService — KYC-based transaction limits.
 */

const mockRedisGet = jest.fn();
const mockRedisIncrBy = jest.fn().mockResolvedValue(1);
const mockRedisExpire = jest.fn().mockResolvedValue(true);

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    incrBy: (...args: unknown[]) => mockRedisIncrBy(...args),
    expire: (...args: unknown[]) => mockRedisExpire(...args),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { PaymentLimitsService } from '../../src/services/payment-limits.service';

describe('PaymentLimitsService', () => {
  let service: PaymentLimitsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PaymentLimitsService();
    mockRedisGet.mockResolvedValue(null);
  });

  // ── getLimits ─────────────────────────────────────

  describe('getLimits', () => {
    it('returns BASIC limits', () => {
      const l = service.getLimits('BASIC');
      expect(l.perTransaction).toBe(50_000);
      expect(l.daily).toBe(200_000);
      expect(l.monthly).toBe(200_000);
    });

    it('returns INTERMEDIATE limits', () => {
      const l = service.getLimits('INTERMEDIATE');
      expect(l.perTransaction).toBe(500_000);
      expect(l.monthly).toBe(2_000_000);
    });

    it('returns FULL limits', () => {
      const l = service.getLimits('FULL');
      expect(l.perTransaction).toBe(2_000_000);
      expect(l.monthly).toBe(50_000_000);
    });
  });

  // ── checkTransaction ──────────────────────────────

  describe('checkTransaction', () => {
    it('allows transaction within limits', async () => {
      const result = await service.checkTransaction('user-1', 'BASIC', 10_000);
      expect(result.allowed).toBe(true);
    });

    it('rejects transaction exceeding per-tx limit', async () => {
      const result = await service.checkTransaction('user-1', 'BASIC', 60_000);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('límite por transacción');
    });

    it('rejects when daily limit would be exceeded', async () => {
      mockRedisGet.mockResolvedValue('180000'); // already used 180k of 200k daily
      const result = await service.checkTransaction('user-1', 'BASIC', 30_000);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('diario');
    });

    it('rejects when monthly limit would be exceeded', async () => {
      // daily = 0, monthly = 190000
      mockRedisGet
        .mockResolvedValueOnce(null)     // daily
        .mockResolvedValueOnce('190000'); // monthly
      const result = await service.checkTransaction('user-1', 'BASIC', 20_000);
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain('mensual');
    });

    it('returns limit status with the check', async () => {
      const result = await service.checkTransaction('user-1', 'BASIC', 5_000);
      expect(result.limitsStatus.kycLevel).toBe('BASIC');
      expect(result.limitsStatus.remaining.perTransactionFormatted).toBeTruthy();
    });
  });

  // ── recordTransaction ─────────────────────────────

  describe('recordTransaction', () => {
    it('increments daily and monthly counters', async () => {
      await service.recordTransaction('user-1', 15_000);
      expect(mockRedisIncrBy).toHaveBeenCalledTimes(2);
      expect(mockRedisExpire).toHaveBeenCalledTimes(2);
    });
  });

  // ── getStatus ─────────────────────────────────────

  describe('getStatus', () => {
    it('returns zero usage for new user', async () => {
      const status = await service.getStatus('user-1', 'BASIC');
      expect(status.used.daily).toBe(0);
      expect(status.used.monthly).toBe(0);
      expect(status.remaining.daily).toBe(200_000);
      expect(status.nearLimit).toBe(false);
    });

    it('calculates percent used', async () => {
      mockRedisGet
        .mockResolvedValueOnce('160000')  // daily (80%)
        .mockResolvedValueOnce('50000');   // monthly (25%)
      const status = await service.getStatus('user-1', 'BASIC');
      expect(status.percentUsed.daily).toBe(80);
      expect(status.percentUsed.monthly).toBe(25);
    });

    it('flags nearLimit at 80%', async () => {
      mockRedisGet
        .mockResolvedValueOnce('170000')  // daily (85%)
        .mockResolvedValueOnce('50000');
      const status = await service.getStatus('user-1', 'BASIC');
      expect(status.nearLimit).toBe(true);
    });

    it('remaining perTransaction is min of all limits', async () => {
      mockRedisGet
        .mockResolvedValueOnce('195000')  // daily: only 5k remaining
        .mockResolvedValueOnce('100000');
      const status = await service.getStatus('user-1', 'BASIC');
      expect(status.remaining.perTransaction).toBe(5_000); // limited by daily
    });

    it('formats amounts correctly', async () => {
      const status = await service.getStatus('user-1', 'INTERMEDIATE');
      expect(status.remaining.dailyFormatted).toBe('$2.000.000');
    });
  });
});
