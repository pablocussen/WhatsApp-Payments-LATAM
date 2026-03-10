/**
 * Unit tests for SpendingLimitsService.
 * Redis is fully mocked.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisMulti = jest.fn();

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test' },
}));

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    multi: () => mockRedisMulti(),
  }),
}));

import { SpendingLimitsService } from '../../src/services/spending-limits.service';

describe('SpendingLimitsService', () => {
  let svc: SpendingLimitsService;

  beforeEach(() => {
    svc = new SpendingLimitsService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
  });

  // ─── getLimits ──────────────────────────────────────────

  describe('getLimits', () => {
    it('returns defaults when no limits stored', async () => {
      const limits = await svc.getLimits('uid-1');
      expect(limits).toEqual({ dailyLimit: 0, weeklyLimit: 0, alertThreshold: 80 });
    });

    it('returns stored limits merged with defaults', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ dailyLimit: 50000 }));
      const limits = await svc.getLimits('uid-1');
      expect(limits.dailyLimit).toBe(50000);
      expect(limits.weeklyLimit).toBe(0);
      expect(limits.alertThreshold).toBe(80);
    });

    it('returns defaults on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const limits = await svc.getLimits('uid-1');
      expect(limits).toEqual({ dailyLimit: 0, weeklyLimit: 0, alertThreshold: 80 });
    });
  });

  // ─── setLimits ─────────────────────────────────────────

  describe('setLimits', () => {
    it('sets daily limit', async () => {
      const limits = await svc.setLimits('uid-1', { dailyLimit: 100000 });
      expect(limits.dailyLimit).toBe(100000);
      expect(mockRedisSet).toHaveBeenCalledWith(
        'spending:limits:uid-1',
        expect.stringContaining('"dailyLimit":100000'),
        { EX: 365 * 24 * 60 * 60 },
      );
    });

    it('sets weekly limit', async () => {
      const limits = await svc.setLimits('uid-1', { weeklyLimit: 500000 });
      expect(limits.weeklyLimit).toBe(500000);
    });

    it('sets alert threshold', async () => {
      const limits = await svc.setLimits('uid-1', { alertThreshold: 90 });
      expect(limits.alertThreshold).toBe(90);
    });

    it('merges with existing limits', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ dailyLimit: 50000, weeklyLimit: 200000, alertThreshold: 80 }));
      const limits = await svc.setLimits('uid-1', { dailyLimit: 75000 });
      expect(limits.dailyLimit).toBe(75000);
      expect(limits.weeklyLimit).toBe(200000);
    });

    it('rejects negative daily limit', async () => {
      await expect(svc.setLimits('uid-1', { dailyLimit: -1 })).rejects.toThrow('Límite debe ser >= 0');
    });

    it('rejects negative weekly limit', async () => {
      await expect(svc.setLimits('uid-1', { weeklyLimit: -100 })).rejects.toThrow('Límite debe ser >= 0');
    });

    it('rejects alert threshold > 100', async () => {
      await expect(svc.setLimits('uid-1', { alertThreshold: 101 })).rejects.toThrow('Umbral de alerta debe estar entre 0 y 100');
    });

    it('rejects alert threshold < 0', async () => {
      await expect(svc.setLimits('uid-1', { alertThreshold: -5 })).rejects.toThrow('Umbral de alerta debe estar entre 0 y 100');
    });

    it('does not throw on Redis save error', async () => {
      mockRedisSet.mockRejectedValue(new Error('Redis down'));
      const limits = await svc.setLimits('uid-1', { dailyLimit: 50000 });
      expect(limits.dailyLimit).toBe(50000);
    });
  });

  // ─── recordSpending ────────────────────────────────────

  describe('recordSpending', () => {
    let mockPipeline: Record<string, jest.Mock>;

    beforeEach(() => {
      mockPipeline = {
        incrBy: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([5000, true, 15000, true]),
      };
      mockRedisMulti.mockReturnValue(mockPipeline);
    });

    it('records spending without alerts when no limits set', async () => {
      const alerts = await svc.recordSpending('uid-1', 5000);
      expect(alerts).toEqual([]);
      expect(mockPipeline.incrBy).toHaveBeenCalledTimes(2);
    });

    it('returns daily alert when threshold exceeded', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ dailyLimit: 10000, weeklyLimit: 0, alertThreshold: 80 }));
      mockPipeline.exec.mockResolvedValue([9000, true, 9000, true]); // 90% of 10000

      const alerts = await svc.recordSpending('uid-1', 1000);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toContain('90%');
      expect(alerts[0]).toContain('diario');
    });

    it('returns daily exceeded alert when over limit', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ dailyLimit: 10000, weeklyLimit: 0, alertThreshold: 80 }));
      mockPipeline.exec.mockResolvedValue([12000, true, 12000, true]);

      const alerts = await svc.recordSpending('uid-1', 5000);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toContain('superado');
      expect(alerts[0]).toContain('diario');
    });

    it('returns weekly alert when threshold exceeded', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ dailyLimit: 0, weeklyLimit: 100000, alertThreshold: 80 }));
      mockPipeline.exec.mockResolvedValue([5000, true, 85000, true]); // 85% of 100000

      const alerts = await svc.recordSpending('uid-1', 5000);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toContain('85%');
      expect(alerts[0]).toContain('semanal');
    });

    it('returns weekly exceeded alert when over limit', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ dailyLimit: 0, weeklyLimit: 100000, alertThreshold: 80 }));
      mockPipeline.exec.mockResolvedValue([5000, true, 110000, true]);

      const alerts = await svc.recordSpending('uid-1', 15000);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]).toContain('superado');
      expect(alerts[0]).toContain('semanal');
    });

    it('returns both daily and weekly alerts', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ dailyLimit: 10000, weeklyLimit: 50000, alertThreshold: 80 }));
      mockPipeline.exec.mockResolvedValue([11000, true, 55000, true]);

      const alerts = await svc.recordSpending('uid-1', 5000);
      expect(alerts).toHaveLength(2);
    });

    it('returns empty alerts on Redis error', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ dailyLimit: 10000, weeklyLimit: 0, alertThreshold: 80 }));
      mockRedisMulti.mockReturnValue({
        incrBy: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error('Redis down')),
      });

      const alerts = await svc.recordSpending('uid-1', 5000);
      expect(alerts).toEqual([]);
    });
  });

  // ─── getStatus ─────────────────────────────────────────

  describe('getStatus', () => {
    it('returns zero status when no limits and no spending', async () => {
      const status = await svc.getStatus('uid-1');
      expect(status.daily.spent).toBe(0);
      expect(status.daily.limit).toBe(0);
      expect(status.daily.remaining).toBe(-1); // no limit
      expect(status.daily.percentage).toBe(0);
      expect(status.weekly.spent).toBe(0);
      expect(status.weekly.remaining).toBe(-1);
      expect(status.alerts).toEqual([]);
    });

    it('returns spending status with limits', async () => {
      // First call: getLimits, second: daily counter, third: weekly counter
      mockRedisGet
        .mockResolvedValueOnce(JSON.stringify({ dailyLimit: 100000, weeklyLimit: 500000, alertThreshold: 80 }))
        .mockResolvedValueOnce('30000')   // daily spent
        .mockResolvedValueOnce('120000'); // weekly spent

      const status = await svc.getStatus('uid-1');
      expect(status.daily.spent).toBe(30000);
      expect(status.daily.limit).toBe(100000);
      expect(status.daily.remaining).toBe(70000);
      expect(status.daily.percentage).toBe(30);
      expect(status.weekly.spent).toBe(120000);
      expect(status.weekly.limit).toBe(500000);
      expect(status.weekly.remaining).toBe(380000);
      expect(status.weekly.percentage).toBe(24);
    });

    it('caps percentage at 100', async () => {
      mockRedisGet
        .mockResolvedValueOnce(JSON.stringify({ dailyLimit: 10000, weeklyLimit: 0, alertThreshold: 80 }))
        .mockResolvedValueOnce('15000')
        .mockResolvedValueOnce(null);

      const status = await svc.getStatus('uid-1');
      expect(status.daily.percentage).toBe(100);
      expect(status.daily.remaining).toBe(0);
    });

    it('returns defaults on Redis error', async () => {
      mockRedisGet
        .mockResolvedValueOnce(JSON.stringify({ dailyLimit: 50000, weeklyLimit: 0, alertThreshold: 80 }))
        .mockRejectedValueOnce(new Error('Redis down'));

      const status = await svc.getStatus('uid-1');
      expect(status.daily.spent).toBe(0);
      expect(status.weekly.spent).toBe(0);
    });
  });
});
