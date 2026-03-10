/**
 * Unit tests for ActivityService.
 * Redis is fully mocked.
 */

const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisGet = jest.fn();
const mockRedisLRange = jest.fn();
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

import { ActivityService } from '../../src/services/activity.service';
import type { ActivityEvent } from '../../src/services/activity.service';

describe('ActivityService', () => {
  let svc: ActivityService;

  beforeEach(() => {
    svc = new ActivityService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisLRange.mockResolvedValue([]);

    // Default multi mock
    mockRedisMulti.mockReturnValue({
      set: jest.fn().mockReturnThis(),
      incr: jest.fn().mockReturnThis(),
      lPush: jest.fn().mockReturnThis(),
      lTrim: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    });
  });

  // ─── record ──────────────────────────────────────────

  describe('record', () => {
    it('records event via Redis pipeline', async () => {
      const event: ActivityEvent = {
        type: 'LOGIN',
        userId: 'uid-1',
        timestamp: '2026-03-09T12:00:00Z',
      };

      await svc.record(event);

      const multi = mockRedisMulti();
      expect(multi.set).toHaveBeenCalled();
      expect(multi.incr).toHaveBeenCalled(); // LOGIN increments counter
      expect(multi.lPush).toHaveBeenCalled();
      expect(multi.lTrim).toHaveBeenCalled();
      expect(multi.expire).toHaveBeenCalled();
    });

    it('does not increment login counter for non-LOGIN events', async () => {
      const multi = mockRedisMulti();

      await svc.record({
        type: 'PAYMENT_SENT',
        userId: 'uid-1',
        timestamp: '2026-03-09T12:00:00Z',
      });

      expect(multi.incr).not.toHaveBeenCalled();
    });

    it('does not throw on Redis error', async () => {
      mockRedisMulti.mockReturnValue({
        set: jest.fn().mockReturnThis(),
        incr: jest.fn().mockReturnThis(),
        lPush: jest.fn().mockReturnThis(),
        lTrim: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error('Redis down')),
      });

      await expect(svc.record({
        type: 'LOGIN',
        userId: 'uid-1',
        timestamp: '2026-03-09T12:00:00Z',
      })).resolves.toBeUndefined();
    });

    it('stores event with metadata', async () => {
      const multi = mockRedisMulti();

      await svc.record({
        type: 'PAYMENT_SENT',
        userId: 'uid-1',
        timestamp: '2026-03-09T12:00:00Z',
        metadata: { amount: 10000, receiver: 'uid-2' },
      });

      expect(multi.lPush).toHaveBeenCalledWith(
        'activity:events:uid-1',
        expect.stringContaining('"amount":10000'),
      );
    });
  });

  // ─── getActivity ─────────────────────────────────────

  describe('getActivity', () => {
    it('returns activity summary', async () => {
      mockRedisGet
        .mockResolvedValueOnce('2026-03-09T12:00:00Z') // lastSeen
        .mockResolvedValueOnce('5');                     // loginCount
      mockRedisLRange.mockResolvedValue([
        JSON.stringify({ type: 'LOGIN', userId: 'uid-1', timestamp: '2026-03-09T12:00:00Z' }),
      ]);

      const result = await svc.getActivity('uid-1');

      expect(result.lastSeen).toBe('2026-03-09T12:00:00Z');
      expect(result.loginCount).toBe(5);
      expect(result.recentEvents).toHaveLength(1);
      expect(result.recentEvents[0].type).toBe('LOGIN');
    });

    it('returns defaults when no data exists', async () => {
      const result = await svc.getActivity('uid-unknown');
      expect(result.lastSeen).toBeNull();
      expect(result.loginCount).toBe(0);
      expect(result.recentEvents).toHaveLength(0);
    });

    it('returns defaults on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const result = await svc.getActivity('uid-1');
      expect(result.lastSeen).toBeNull();
      expect(result.loginCount).toBe(0);
    });
  });

  // ─── touch ───────────────────────────────────────────

  describe('touch', () => {
    it('updates last seen timestamp', async () => {
      await svc.touch('uid-1');
      expect(mockRedisSet).toHaveBeenCalledWith(
        'activity:lastseen:uid-1',
        expect.any(String),
        { EX: 30 * 24 * 60 * 60 },
      );
    });

    it('does not throw on Redis error', async () => {
      mockRedisSet.mockRejectedValue(new Error('Redis down'));
      await expect(svc.touch('uid-1')).resolves.toBeUndefined();
    });
  });
});
