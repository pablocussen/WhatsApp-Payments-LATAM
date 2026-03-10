import { randomBytes } from 'crypto';
import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('compliance');

// ─── Types ──────────────────────────────────────────────

export type ComplianceAction =
  | 'LARGE_TRANSFER'        // Amount over threshold
  | 'VELOCITY_ALERT'        // Too many transactions in short period
  | 'KYC_LIMIT_APPROACH'    // Approaching KYC monthly limit
  | 'CROSS_BORDER'          // Cross-border operation (future)
  | 'UNUSUAL_PATTERN'       // Unusual transaction pattern
  | 'ACCOUNT_FROZEN'        // Account frozen by system
  | 'MANUAL_REVIEW';        // Flagged for manual review

export type ComplianceSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface ComplianceEntry {
  id: string;
  action: ComplianceAction;
  severity: ComplianceSeverity;
  userId: string;
  transactionRef: string | null;
  amount: number | null;
  description: string;
  reviewed: boolean;
  reviewedBy: string | null;
  reviewedAt: string | null;
  timestamp: string;
}

export interface ComplianceStats {
  total: number;
  pending: number;
  bySeverity: Record<ComplianceSeverity, number>;
}

const LOG_PREFIX = 'compliance:log:';
const GLOBAL_LOG = 'compliance:global';
const STATS_KEY = 'compliance:stats';
const LOG_TTL = 365 * 24 * 60 * 60;
const MAX_USER_ENTRIES = 100;
const MAX_GLOBAL_ENTRIES = 500;

// ─── Service ────────────────────────────────────────────

export class ComplianceLogService {
  /**
   * Record a compliance event.
   */
  async record(
    action: ComplianceAction,
    severity: ComplianceSeverity,
    userId: string,
    description: string,
    opts: { transactionRef?: string; amount?: number } = {},
  ): Promise<ComplianceEntry> {
    const entry: ComplianceEntry = {
      id: `cmp_${randomBytes(8).toString('hex')}`,
      action,
      severity,
      userId,
      transactionRef: opts.transactionRef ?? null,
      amount: opts.amount ?? null,
      description,
      reviewed: false,
      reviewedBy: null,
      reviewedAt: null,
      timestamp: new Date().toISOString(),
    };

    try {
      const redis = getRedis();
      const serialized = JSON.stringify(entry);

      const pipeline = redis.multi();
      pipeline.lPush(`${LOG_PREFIX}${userId}`, serialized);
      pipeline.lTrim(`${LOG_PREFIX}${userId}`, 0, MAX_USER_ENTRIES - 1);
      pipeline.expire(`${LOG_PREFIX}${userId}`, LOG_TTL);
      pipeline.lPush(GLOBAL_LOG, serialized);
      pipeline.lTrim(GLOBAL_LOG, 0, MAX_GLOBAL_ENTRIES - 1);
      pipeline.expire(GLOBAL_LOG, LOG_TTL);
      await pipeline.exec();

      // Update stats counter
      await this.incrementStats(severity);
    } catch (err) {
      log.warn('Compliance log failed', { action, userId, error: (err as Error).message });
    }

    log.info('Compliance event recorded', {
      id: entry.id,
      action,
      severity,
      userId,
    });

    return entry;
  }

  /**
   * Get compliance log for a user.
   */
  async getUserLog(userId: string, limit = 50): Promise<ComplianceEntry[]> {
    try {
      const redis = getRedis();
      const entries = await redis.lRange(`${LOG_PREFIX}${userId}`, 0, limit - 1);
      return entries.map((e: string) => JSON.parse(e) as ComplianceEntry);
    } catch {
      return [];
    }
  }

  /**
   * Get global compliance log (admin).
   */
  async getGlobalLog(limit = 100): Promise<ComplianceEntry[]> {
    try {
      const redis = getRedis();
      const entries = await redis.lRange(GLOBAL_LOG, 0, limit - 1);
      return entries.map((e: string) => JSON.parse(e) as ComplianceEntry);
    } catch {
      return [];
    }
  }

  /**
   * Mark an entry as reviewed.
   */
  async markReviewed(entryId: string, userId: string, reviewedBy: string): Promise<boolean> {
    const entries = await this.getUserLog(userId, MAX_USER_ENTRIES);
    const entry = entries.find((e) => e.id === entryId);
    if (!entry || entry.reviewed) return false;

    entry.reviewed = true;
    entry.reviewedBy = reviewedBy;
    entry.reviewedAt = new Date().toISOString();

    // Re-save entire user log (replace the entry)
    try {
      const redis = getRedis();
      const updated = entries.map((e) => (e.id === entryId ? entry : e));
      // Delete + re-push (atomic replacement)
      const pipeline = redis.multi();
      pipeline.del(`${LOG_PREFIX}${userId}`);
      for (const e of updated.reverse()) {
        pipeline.lPush(`${LOG_PREFIX}${userId}`, JSON.stringify(e));
      }
      pipeline.expire(`${LOG_PREFIX}${userId}`, LOG_TTL);
      await pipeline.exec();

      await this.decrementPending();
    } catch (err) {
      log.warn('Failed to mark reviewed', { entryId, error: (err as Error).message });
      return false;
    }

    return true;
  }

  /**
   * Get compliance statistics.
   */
  async getStats(): Promise<ComplianceStats> {
    try {
      const redis = getRedis();
      const raw = await redis.get(STATS_KEY);
      if (!raw) return { total: 0, pending: 0, bySeverity: { low: 0, medium: 0, high: 0, critical: 0 } };
      return JSON.parse(raw) as ComplianceStats;
    } catch {
      return { total: 0, pending: 0, bySeverity: { low: 0, medium: 0, high: 0, critical: 0 } };
    }
  }

  // ─── Helpers ────────────────────────────────────────────

  private async incrementStats(severity: ComplianceSeverity): Promise<void> {
    try {
      const redis = getRedis();
      const stats = await this.getStats();
      stats.total += 1;
      stats.pending += 1;
      stats.bySeverity[severity] += 1;
      await redis.set(STATS_KEY, JSON.stringify(stats), { EX: LOG_TTL });
    } catch {
      // Silent
    }
  }

  private async decrementPending(): Promise<void> {
    try {
      const redis = getRedis();
      const stats = await this.getStats();
      stats.pending = Math.max(0, stats.pending - 1);
      await redis.set(STATS_KEY, JSON.stringify(stats), { EX: LOG_TTL });
    } catch {
      // Silent
    }
  }
}

export const complianceLog = new ComplianceLogService();
