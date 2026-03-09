import { prisma } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('scheduler');

// ─── Scheduled Jobs ──────────────────────────────────────

export class SchedulerService {
  private intervals: NodeJS.Timeout[] = [];

  /**
   * Start all scheduled jobs. Safe to call multiple times — clears previous.
   */
  start(): void {
    this.stop();

    // Every 15 minutes: deactivate expired payment links
    this.intervals.push(
      setInterval(() => void this.cleanExpiredLinks(), 15 * 60 * 1000),
    );

    // Every hour: clean stale PENDING/PROCESSING transactions (>24h)
    this.intervals.push(
      setInterval(() => void this.cleanStaleTransactions(), 60 * 60 * 1000),
    );

    log.info('Scheduler started', { jobs: ['cleanExpiredLinks', 'cleanStaleTransactions'] });
  }

  /**
   * Stop all jobs gracefully.
   */
  stop(): void {
    for (const id of this.intervals) clearInterval(id);
    this.intervals = [];
  }

  /**
   * Deactivate payment links past their expiresAt date.
   * Returns count of deactivated links.
   */
  async cleanExpiredLinks(): Promise<number> {
    try {
      const result = await prisma.paymentLink.updateMany({
        where: {
          isActive: true,
          expiresAt: { lt: new Date() },
        },
        data: { isActive: false },
      });

      if (result.count > 0) {
        log.info('Expired links deactivated', { count: result.count });
      }
      return result.count;
    } catch (err) {
      log.error('cleanExpiredLinks failed', { error: (err as Error).message });
      return 0;
    }
  }

  /**
   * Mark PENDING/PROCESSING transactions older than 24h as FAILED.
   * These are orphaned transactions from interrupted flows.
   */
  async cleanStaleTransactions(): Promise<number> {
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const result = await prisma.transaction.updateMany({
        where: {
          status: { in: ['PENDING', 'PROCESSING'] },
          createdAt: { lt: cutoff },
        },
        data: { status: 'FAILED' },
      });

      if (result.count > 0) {
        log.info('Stale transactions marked FAILED', { count: result.count });
      }
      return result.count;
    } catch (err) {
      log.error('cleanStaleTransactions failed', { error: (err as Error).message });
      return 0;
    }
  }
}
