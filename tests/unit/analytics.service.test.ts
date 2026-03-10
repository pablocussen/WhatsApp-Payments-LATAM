/**
 * Unit tests for AnalyticsService.
 * Redis is fully mocked.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisSCard = jest.fn().mockResolvedValue(0);
const mockRedisSAdd = jest.fn().mockResolvedValue(1);
const mockRedisMulti = jest.fn();

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test' },
}));

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    sCard: (...args: unknown[]) => mockRedisSCard(...args),
    sAdd: (...args: unknown[]) => mockRedisSAdd(...args),
    multi: () => mockRedisMulti(),
  }),
}));

import { AnalyticsService } from '../../src/services/analytics.service';

describe('AnalyticsService', () => {
  let svc: AnalyticsService;
  let mockPipeline: Record<string, jest.Mock>;

  beforeEach(() => {
    svc = new AnalyticsService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRedisSCard.mockResolvedValue(0);
    mockRedisSAdd.mockResolvedValue(1);

    mockPipeline = {
      incrBy: jest.fn().mockReturnThis(),
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      sAdd: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    };
    mockRedisMulti.mockReturnValue(mockPipeline);
  });

  // ─── trackTransaction ─────────────────────────────────

  describe('trackTransaction', () => {
    const txData = {
      senderId: 'uid-1',
      receiverId: 'uid-2',
      senderPhone: '+56911111111',
      receiverPhone: '+56922222222',
      amount: 10000,
      timestamp: '2026-03-10T14:30:00Z',
    };

    it('tracks daily volume via pipeline', async () => {
      await svc.trackTransaction(txData);
      expect(mockPipeline.incrBy).toHaveBeenCalled();
      expect(mockPipeline.incr).toHaveBeenCalled();
      expect(mockPipeline.exec).toHaveBeenCalled();
    });

    it('tracks sender insights (sent amount)', async () => {
      await svc.trackTransaction(txData);
      expect(mockPipeline.incrBy).toHaveBeenCalledWith(
        expect.stringContaining('uid-1:sent'),
        10000,
      );
    });

    it('tracks receiver insights (received amount)', async () => {
      await svc.trackTransaction(txData);
      expect(mockPipeline.incrBy).toHaveBeenCalledWith(
        expect.stringContaining('uid-2:received'),
        10000,
      );
    });

    it('tracks hour distribution', async () => {
      await svc.trackTransaction(txData);
      expect(mockPipeline.incr).toHaveBeenCalledWith(
        expect.stringContaining('hour:'),
      );
    });

    it('tracks day of week', async () => {
      await svc.trackTransaction(txData);
      expect(mockPipeline.incr).toHaveBeenCalledWith(
        expect.stringContaining('dow:'),
      );
    });

    it('adds sender to DAU set', async () => {
      await svc.trackTransaction(txData);
      expect(mockPipeline.sAdd).toHaveBeenCalledWith(
        expect.stringContaining('dau:'),
        'uid-1',
      );
    });

    it('tracks recipient for top recipients', async () => {
      await svc.trackTransaction(txData);
      // trackRecipient reads then writes
      expect(mockRedisSet).toHaveBeenCalledWith(
        expect.stringContaining('uid-1:recipients'),
        expect.stringContaining('+56922222222'),
        expect.any(Object),
      );
    });

    it('updates existing recipient count', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify([
        { phone: '+56922222222', count: 3, totalAmount: 30000 },
      ]));

      await svc.trackTransaction(txData);

      const savedStr = mockRedisSet.mock.calls.find(
        (c: unknown[]) => (c[0] as string).includes('recipients'),
      )?.[1] as string;
      const saved = JSON.parse(savedStr);
      expect(saved[0].count).toBe(4);
      expect(saved[0].totalAmount).toBe(40000);
    });

    it('does not throw on Redis error', async () => {
      mockPipeline.exec.mockRejectedValue(new Error('Redis down'));
      await expect(svc.trackTransaction(txData)).resolves.toBeUndefined();
    });
  });

  // ─── trackActiveUser ───────────────────────────────────

  describe('trackActiveUser', () => {
    it('adds to DAU, WAU, MAU sets', async () => {
      await svc.trackActiveUser('uid-1');
      expect(mockPipeline.sAdd).toHaveBeenCalledTimes(3);
      expect(mockPipeline.expire).toHaveBeenCalledTimes(3);
      expect(mockPipeline.exec).toHaveBeenCalled();
    });

    it('does not throw on Redis error', async () => {
      mockPipeline.exec.mockRejectedValue(new Error('Redis down'));
      await expect(svc.trackActiveUser('uid-1')).resolves.toBeUndefined();
    });
  });

  // ─── getDailyStats ─────────────────────────────────────

  describe('getDailyStats', () => {
    it('returns stats for date range', async () => {
      mockRedisGet
        .mockResolvedValueOnce('50000')  // amount day 1
        .mockResolvedValueOnce('5')      // count day 1
        .mockResolvedValueOnce('30000')  // amount day 2
        .mockResolvedValueOnce('3');     // count day 2

      const stats = await svc.getDailyStats('2026-03-09', '2026-03-10');
      expect(stats).toHaveLength(2);
      expect(stats[0].date).toBe('2026-03-09');
      expect(stats[0].totalAmount).toBe(50000);
      expect(stats[0].transactionCount).toBe(5);
      expect(stats[0].averageAmount).toBe(10000);
      expect(stats[1].totalAmount).toBe(30000);
    });

    it('returns zeros for dates with no data', async () => {
      const stats = await svc.getDailyStats('2026-03-10', '2026-03-10');
      expect(stats).toHaveLength(1);
      expect(stats[0].totalAmount).toBe(0);
      expect(stats[0].transactionCount).toBe(0);
      expect(stats[0].averageAmount).toBe(0);
    });

    it('returns empty on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const stats = await svc.getDailyStats('2026-03-10', '2026-03-10');
      expect(stats).toEqual([]);
    });
  });

  // ─── getUserInsights ───────────────────────────────────

  describe('getUserInsights', () => {
    it('returns aggregated insights', async () => {
      // sent, received, count
      mockRedisGet
        .mockResolvedValueOnce('150000')  // sent
        .mockResolvedValueOnce('80000')   // received
        .mockResolvedValueOnce('15')      // count
        // 24 hours (all null except hour 14)
        .mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce('8')
        .mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce(null)
        // 7 days of week
        .mockResolvedValueOnce('3').mockResolvedValueOnce('2').mockResolvedValueOnce('4')
        .mockResolvedValueOnce('1').mockResolvedValueOnce('5').mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        // recipients
        .mockResolvedValueOnce(JSON.stringify([
          { phone: '+56922222222', count: 5, totalAmount: 50000 },
        ]));

      const insights = await svc.getUserInsights('uid-1');
      expect(insights.totalSent).toBe(150000);
      expect(insights.totalReceived).toBe(80000);
      expect(insights.transactionCount).toBe(15);
      expect(insights.averageTransaction).toBe(10000);
      expect(insights.peakHour).toBe(14);
      expect(insights.topRecipients).toHaveLength(1);
      expect(insights.byDayOfWeek['Fri']).toBe(5);
    });

    it('returns defaults when no data', async () => {
      const insights = await svc.getUserInsights('uid-unknown');
      expect(insights.totalSent).toBe(0);
      expect(insights.totalReceived).toBe(0);
      expect(insights.transactionCount).toBe(0);
      expect(insights.topRecipients).toEqual([]);
    });

    it('returns defaults on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const insights = await svc.getUserInsights('uid-1');
      expect(insights.totalSent).toBe(0);
    });
  });

  // ─── getActiveUserCounts ───────────────────────────────

  describe('getActiveUserCounts', () => {
    it('returns DAU, WAU, MAU from Redis sets', async () => {
      mockRedisSCard
        .mockResolvedValueOnce(42)   // DAU
        .mockResolvedValueOnce(180)  // WAU
        .mockResolvedValueOnce(520); // MAU

      const counts = await svc.getActiveUserCounts();
      expect(counts.dau).toBe(42);
      expect(counts.wau).toBe(180);
      expect(counts.mau).toBe(520);
    });

    it('returns zeros on Redis error', async () => {
      mockRedisSCard.mockRejectedValue(new Error('Redis down'));
      const counts = await svc.getActiveUserCounts();
      expect(counts).toEqual({ dau: 0, wau: 0, mau: 0 });
    });
  });
});
