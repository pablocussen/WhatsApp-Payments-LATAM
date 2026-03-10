/**
 * Unit tests for RateLimitService.
 * Redis is fully mocked.
 */

const mockRedisMulti = jest.fn();
const mockRedisZAdd = jest.fn().mockResolvedValue(1);
const mockRedisZRange = jest.fn().mockResolvedValue([]);
const mockRedisExpire = jest.fn().mockResolvedValue(1);
const mockRedisDel = jest.fn().mockResolvedValue(1);

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test' },
}));

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    multi: () => mockRedisMulti(),
    zAdd: (...args: unknown[]) => mockRedisZAdd(...args),
    zRange: (...args: unknown[]) => mockRedisZRange(...args),
    expire: (...args: unknown[]) => mockRedisExpire(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
  }),
}));

import { RateLimitService } from '../../src/services/rate-limit.service';

describe('RateLimitService', () => {
  let svc: RateLimitService;
  let mockPipeline: Record<string, jest.Mock>;

  beforeEach(() => {
    svc = new RateLimitService();
    jest.clearAllMocks();

    mockPipeline = {
      zRemRangeByScore: jest.fn().mockReturnThis(),
      zCard: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([0, 0]), // [removed count, current count]
    };
    mockRedisMulti.mockReturnValue(mockPipeline);
    mockRedisZAdd.mockResolvedValue(1);
    mockRedisZRange.mockResolvedValue([]);
    mockRedisExpire.mockResolvedValue(1);
    mockRedisDel.mockResolvedValue(1);
  });

  // ─── check ─────────────────────────────────────────────

  describe('check', () => {
    it('allows request under limit', async () => {
      mockPipeline.exec.mockResolvedValue([0, 3]); // 3 existing requests
      const result = await svc.check('payment:create', 'uid-1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(6); // 10 - 3 - 1
      expect(result.total).toBe(4);
    });

    it('blocks request at limit', async () => {
      mockPipeline.exec.mockResolvedValue([0, 10]); // at max
      const result = await svc.check('payment:create', 'uid-1');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('calculates reset time from oldest entry', async () => {
      const now = Math.floor(Date.now() / 1000);
      mockPipeline.exec.mockResolvedValue([0, 10]);
      mockRedisZRange.mockResolvedValue([String(now - 1800)]); // oldest is 30 min ago

      const result = await svc.check('payment:create', 'uid-1');
      expect(result.allowed).toBe(false);
      expect(result.resetInSeconds).toBeGreaterThan(0);
      expect(result.resetInSeconds).toBeLessThanOrEqual(3600);
    });

    it('allows unknown action (no config)', async () => {
      const result = await svc.check('unknown:action', 'uid-1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(-1);
    });

    it('fails open on Redis error', async () => {
      mockPipeline.exec.mockRejectedValue(new Error('Redis down'));
      const result = await svc.check('payment:create', 'uid-1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(-1);
    });

    it('adds request to sorted set after allowing', async () => {
      mockPipeline.exec.mockResolvedValue([0, 0]);
      await svc.check('payment:create', 'uid-1');
      expect(mockRedisZAdd).toHaveBeenCalledWith(
        'ratelimit:payment:create:uid-1',
        expect.objectContaining({ score: expect.any(Number) }),
      );
      expect(mockRedisExpire).toHaveBeenCalled();
    });

    it('does not add to sorted set when blocked', async () => {
      mockPipeline.exec.mockResolvedValue([0, 10]);
      await svc.check('payment:create', 'uid-1');
      expect(mockRedisZAdd).not.toHaveBeenCalled();
    });

    it('uses custom override when set', async () => {
      svc.setLimit('payment:create', { maxRequests: 3, windowSeconds: 60 });
      mockPipeline.exec.mockResolvedValue([0, 3]);

      const result = await svc.check('payment:create', 'uid-1');
      expect(result.allowed).toBe(false);
    });
  });

  // ─── setLimit / removeOverride ─────────────────────────

  describe('setLimit', () => {
    it('overrides default config', () => {
      svc.setLimit('api:general', { maxRequests: 50, windowSeconds: 30 });
      const config = svc.getConfig('api:general');
      expect(config!.maxRequests).toBe(50);
      expect(config!.windowSeconds).toBe(30);
    });

    it('creates new action config', () => {
      svc.setLimit('custom:action', { maxRequests: 5, windowSeconds: 120 });
      const config = svc.getConfig('custom:action');
      expect(config).not.toBeNull();
      expect(config!.maxRequests).toBe(5);
    });

    it('rejects maxRequests < 1', () => {
      expect(() => svc.setLimit('test', { maxRequests: 0, windowSeconds: 60 }))
        .toThrow('maxRequests debe ser >= 1');
    });

    it('rejects windowSeconds < 1', () => {
      expect(() => svc.setLimit('test', { maxRequests: 10, windowSeconds: 0 }))
        .toThrow('windowSeconds debe ser >= 1');
    });
  });

  describe('removeOverride', () => {
    it('reverts to default config', () => {
      svc.setLimit('api:general', { maxRequests: 1, windowSeconds: 1 });
      svc.removeOverride('api:general');
      const config = svc.getConfig('api:general');
      expect(config!.maxRequests).toBe(100); // default
    });
  });

  // ─── getConfig ─────────────────────────────────────────

  describe('getConfig', () => {
    it('returns default config for known action', () => {
      const config = svc.getConfig('payment:create');
      expect(config).not.toBeNull();
      expect(config!.maxRequests).toBe(10);
      expect(config!.windowSeconds).toBe(3600);
    });

    it('returns null for unknown action', () => {
      const config = svc.getConfig('nonexistent');
      expect(config).toBeNull();
    });
  });

  // ─── reset ─────────────────────────────────────────────

  describe('reset', () => {
    it('deletes rate limit key', async () => {
      await svc.reset('payment:create', 'uid-1');
      expect(mockRedisDel).toHaveBeenCalledWith('ratelimit:payment:create:uid-1');
    });

    it('does not throw on Redis error', async () => {
      mockRedisDel.mockRejectedValue(new Error('Redis down'));
      await expect(svc.reset('payment:create', 'uid-1')).resolves.toBeUndefined();
    });
  });

  // ─── getAllLimits ──────────────────────────────────────

  describe('getAllLimits', () => {
    it('returns all defaults', () => {
      const limits = svc.getAllLimits();
      expect(limits['payment:create']).toBeDefined();
      expect(limits['auth:login']).toBeDefined();
      expect(limits['api:general']).toBeDefined();
    });

    it('includes overrides', () => {
      svc.setLimit('custom:test', { maxRequests: 3, windowSeconds: 30 });
      const limits = svc.getAllLimits();
      expect(limits['custom:test']).toBeDefined();
      expect(limits['custom:test'].maxRequests).toBe(3);
    });
  });
});
