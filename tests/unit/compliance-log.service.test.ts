/**
 * Unit tests for ComplianceLogService.
 * Redis is fully mocked.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisLRange = jest.fn().mockResolvedValue([]);
const mockRedisMulti = jest.fn();

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test' },
}));

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    lRange: (...args: unknown[]) => mockRedisLRange(...args),
    multi: () => mockRedisMulti(),
  }),
}));

import { ComplianceLogService } from '../../src/services/compliance-log.service';
import type { ComplianceEntry } from '../../src/services/compliance-log.service';

describe('ComplianceLogService', () => {
  let svc: ComplianceLogService;
  let mockPipeline: Record<string, jest.Mock>;

  beforeEach(() => {
    svc = new ComplianceLogService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRedisLRange.mockResolvedValue([]);

    mockPipeline = {
      lPush: jest.fn().mockReturnThis(),
      lTrim: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      del: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    mockRedisMulti.mockReturnValue(mockPipeline);
  });

  // ─── record ────────────────────────────────────────────

  describe('record', () => {
    it('creates entry with cmp_ prefix', async () => {
      const entry = await svc.record('LARGE_TRANSFER', 'high', 'uid-1', 'Transfer over 1M', { amount: 1500000 });
      expect(entry.id).toMatch(/^cmp_[0-9a-f]{16}$/);
      expect(entry.action).toBe('LARGE_TRANSFER');
      expect(entry.severity).toBe('high');
      expect(entry.userId).toBe('uid-1');
      expect(entry.amount).toBe(1500000);
      expect(entry.reviewed).toBe(false);
    });

    it('uses Redis pipeline for atomic writes', async () => {
      await svc.record('VELOCITY_ALERT', 'medium', 'uid-1', 'Too many txns');
      expect(mockPipeline.lPush).toHaveBeenCalledTimes(2); // user + global
      expect(mockPipeline.lTrim).toHaveBeenCalledTimes(2);
      expect(mockPipeline.expire).toHaveBeenCalledTimes(2);
      expect(mockPipeline.exec).toHaveBeenCalled();
    });

    it('sets transactionRef when provided', async () => {
      const entry = await svc.record('LARGE_TRANSFER', 'high', 'uid-1', 'Big tx', { transactionRef: '#WP-ABC' });
      expect(entry.transactionRef).toBe('#WP-ABC');
    });

    it('sets null for optional fields', async () => {
      const entry = await svc.record('UNUSUAL_PATTERN', 'low', 'uid-1', 'Pattern detected');
      expect(entry.transactionRef).toBeNull();
      expect(entry.amount).toBeNull();
      expect(entry.reviewedBy).toBeNull();
    });

    it('updates stats', async () => {
      await svc.record('LARGE_TRANSFER', 'critical', 'uid-1', 'Very large');
      // incrementStats reads stats then writes
      expect(mockRedisSet).toHaveBeenCalledWith(
        'compliance:stats',
        expect.any(String),
        expect.any(Object),
      );
    });

    it('does not throw on Redis error', async () => {
      mockPipeline.exec.mockRejectedValue(new Error('Redis down'));
      const entry = await svc.record('LARGE_TRANSFER', 'high', 'uid-1', 'Test');
      expect(entry.id).toBeDefined();
    });
  });

  // ─── getUserLog ────────────────────────────────────────

  describe('getUserLog', () => {
    it('returns parsed entries', async () => {
      const entry: ComplianceEntry = {
        id: 'cmp_1', action: 'LARGE_TRANSFER', severity: 'high',
        userId: 'uid-1', transactionRef: null, amount: 500000,
        description: 'Test', reviewed: false, reviewedBy: null,
        reviewedAt: null, timestamp: '2026-03-09',
      };
      mockRedisLRange.mockResolvedValue([JSON.stringify(entry)]);

      const results = await svc.getUserLog('uid-1');
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe('LARGE_TRANSFER');
    });

    it('returns empty when no entries', async () => {
      const results = await svc.getUserLog('uid-1');
      expect(results).toEqual([]);
    });

    it('returns empty on Redis error', async () => {
      mockRedisLRange.mockRejectedValue(new Error('Redis down'));
      const results = await svc.getUserLog('uid-1');
      expect(results).toEqual([]);
    });
  });

  // ─── getGlobalLog ──────────────────────────────────────

  describe('getGlobalLog', () => {
    it('returns global entries', async () => {
      const entry: ComplianceEntry = {
        id: 'cmp_2', action: 'VELOCITY_ALERT', severity: 'medium',
        userId: 'uid-2', transactionRef: '#WP-X', amount: null,
        description: 'Alert', reviewed: false, reviewedBy: null,
        reviewedAt: null, timestamp: '2026-03-09',
      };
      mockRedisLRange.mockResolvedValue([JSON.stringify(entry)]);

      const results = await svc.getGlobalLog();
      expect(results).toHaveLength(1);
    });

    it('returns empty on error', async () => {
      mockRedisLRange.mockRejectedValue(new Error('Redis down'));
      const results = await svc.getGlobalLog();
      expect(results).toEqual([]);
    });
  });

  // ─── markReviewed ──────────────────────────────────────

  describe('markReviewed', () => {
    it('marks entry as reviewed', async () => {
      const entry: ComplianceEntry = {
        id: 'cmp_1', action: 'LARGE_TRANSFER', severity: 'high',
        userId: 'uid-1', transactionRef: null, amount: 500000,
        description: 'Test', reviewed: false, reviewedBy: null,
        reviewedAt: null, timestamp: '2026-03-09',
      };
      mockRedisLRange.mockResolvedValue([JSON.stringify(entry)]);

      const result = await svc.markReviewed('cmp_1', 'uid-1', 'admin-1');
      expect(result).toBe(true);
      expect(mockPipeline.del).toHaveBeenCalled();
      expect(mockPipeline.lPush).toHaveBeenCalled();
    });

    it('returns false for already reviewed entry', async () => {
      const entry: ComplianceEntry = {
        id: 'cmp_1', action: 'LARGE_TRANSFER', severity: 'high',
        userId: 'uid-1', transactionRef: null, amount: 500000,
        description: 'Test', reviewed: true, reviewedBy: 'admin-1',
        reviewedAt: '2026-03-09', timestamp: '2026-03-08',
      };
      mockRedisLRange.mockResolvedValue([JSON.stringify(entry)]);

      const result = await svc.markReviewed('cmp_1', 'uid-1', 'admin-2');
      expect(result).toBe(false);
    });

    it('returns false for unknown entry', async () => {
      const result = await svc.markReviewed('cmp_unknown', 'uid-1', 'admin-1');
      expect(result).toBe(false);
    });

    it('returns false on Redis error during save', async () => {
      const entry: ComplianceEntry = {
        id: 'cmp_1', action: 'LARGE_TRANSFER', severity: 'high',
        userId: 'uid-1', transactionRef: null, amount: 500000,
        description: 'Test', reviewed: false, reviewedBy: null,
        reviewedAt: null, timestamp: '2026-03-09',
      };
      mockRedisLRange.mockResolvedValue([JSON.stringify(entry)]);
      mockPipeline.exec.mockRejectedValue(new Error('Redis down'));

      const result = await svc.markReviewed('cmp_1', 'uid-1', 'admin-1');
      expect(result).toBe(false);
    });
  });

  // ─── getStats ──────────────────────────────────────────

  describe('getStats', () => {
    it('returns stored stats', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({
        total: 15, pending: 3,
        bySeverity: { low: 5, medium: 4, high: 4, critical: 2 },
      }));

      const stats = await svc.getStats();
      expect(stats.total).toBe(15);
      expect(stats.pending).toBe(3);
      expect(stats.bySeverity.critical).toBe(2);
    });

    it('returns zeros when no stats', async () => {
      const stats = await svc.getStats();
      expect(stats.total).toBe(0);
      expect(stats.pending).toBe(0);
    });

    it('returns zeros on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const stats = await svc.getStats();
      expect(stats.total).toBe(0);
    });
  });
});
