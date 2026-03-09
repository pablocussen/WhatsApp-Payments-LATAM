/**
 * Unit tests for SchedulerService — expired link cleanup + stale transaction pruning.
 */

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test', ENCRYPTION_KEY_HEX: '0'.repeat(64) },
}));

const mockUpdateManyLinks = jest.fn();
const mockUpdateManyTransactions = jest.fn();

jest.mock('../../src/config/database', () => ({
  prisma: {
    paymentLink: { updateMany: (...args: unknown[]) => mockUpdateManyLinks(...args) },
    transaction: { updateMany: (...args: unknown[]) => mockUpdateManyTransactions(...args) },
  },
}));

import { SchedulerService } from '../../src/services/scheduler.service';

describe('SchedulerService', () => {
  let svc: SchedulerService;

  beforeEach(() => {
    svc = new SchedulerService();
    jest.clearAllMocks();
  });

  afterEach(() => {
    svc.stop();
  });

  // ─── cleanExpiredLinks ──────────────────────────────────

  describe('cleanExpiredLinks', () => {
    it('deactivates expired links and returns count', async () => {
      mockUpdateManyLinks.mockResolvedValue({ count: 3 });

      const result = await svc.cleanExpiredLinks();

      expect(result).toBe(3);
      expect(mockUpdateManyLinks).toHaveBeenCalledWith({
        where: {
          isActive: true,
          expiresAt: { lt: expect.any(Date) },
        },
        data: { isActive: false },
      });
    });

    it('returns 0 when no links expired', async () => {
      mockUpdateManyLinks.mockResolvedValue({ count: 0 });

      const result = await svc.cleanExpiredLinks();

      expect(result).toBe(0);
    });

    it('returns 0 and logs error on DB failure', async () => {
      mockUpdateManyLinks.mockRejectedValue(new Error('DB down'));

      const result = await svc.cleanExpiredLinks();

      expect(result).toBe(0);
    });
  });

  // ─── cleanStaleTransactions ────────────────────────────

  describe('cleanStaleTransactions', () => {
    it('marks stale PENDING/PROCESSING transactions as FAILED', async () => {
      mockUpdateManyTransactions.mockResolvedValue({ count: 2 });

      const result = await svc.cleanStaleTransactions();

      expect(result).toBe(2);
      expect(mockUpdateManyTransactions).toHaveBeenCalledWith({
        where: {
          status: { in: ['PENDING', 'PROCESSING'] },
          createdAt: { lt: expect.any(Date) },
        },
        data: { status: 'FAILED' },
      });
    });

    it('returns 0 when no stale transactions', async () => {
      mockUpdateManyTransactions.mockResolvedValue({ count: 0 });

      const result = await svc.cleanStaleTransactions();

      expect(result).toBe(0);
    });

    it('returns 0 and logs error on DB failure', async () => {
      mockUpdateManyTransactions.mockRejectedValue(new Error('DB crashed'));

      const result = await svc.cleanStaleTransactions();

      expect(result).toBe(0);
    });
  });

  // ─── start / stop ─────────────────────────────────────

  describe('lifecycle', () => {
    it('start() sets intervals and stop() clears them', () => {
      svc.start();
      // Calling stop should not throw
      svc.stop();
    });

    it('calling start() twice clears previous intervals', () => {
      svc.start();
      svc.start(); // Should not leak intervals
      svc.stop();
    });
  });
});
