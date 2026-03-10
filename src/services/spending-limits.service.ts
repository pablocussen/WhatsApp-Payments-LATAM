import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('spending-limits');

// ─── Types ──────────────────────────────────────────────

export interface SpendingLimits {
  dailyLimit: number;        // 0 = no limit
  weeklyLimit: number;       // 0 = no limit
  alertThreshold: number;    // 0-100 percentage (e.g., 80 = alert at 80% usage)
}

export interface SpendingStatus {
  daily: { spent: number; limit: number; remaining: number; percentage: number };
  weekly: { spent: number; limit: number; remaining: number; percentage: number };
  alerts: string[];
}

const LIMITS_PREFIX = 'spending:limits:';
const DAILY_PREFIX = 'spending:daily:';
const WEEKLY_PREFIX = 'spending:weekly:';
const LIMITS_TTL = 365 * 24 * 60 * 60;

const DEFAULT_LIMITS: SpendingLimits = {
  dailyLimit: 0,
  weeklyLimit: 0,
  alertThreshold: 80,
};

// ─── Service ────────────────────────────────────────────

export class SpendingLimitsService {
  /**
   * Get user's spending limits configuration.
   */
  async getLimits(userId: string): Promise<SpendingLimits> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${LIMITS_PREFIX}${userId}`);
      if (!raw) return { ...DEFAULT_LIMITS };
      return { ...DEFAULT_LIMITS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_LIMITS };
    }
  }

  /**
   * Set spending limits for a user.
   */
  async setLimits(userId: string, limits: Partial<SpendingLimits>): Promise<SpendingLimits> {
    if (limits.dailyLimit != null && limits.dailyLimit < 0) throw new Error('Límite debe ser >= 0');
    if (limits.weeklyLimit != null && limits.weeklyLimit < 0) throw new Error('Límite debe ser >= 0');
    if (limits.alertThreshold != null && (limits.alertThreshold < 0 || limits.alertThreshold > 100)) {
      throw new Error('Umbral de alerta debe estar entre 0 y 100');
    }

    const current = await this.getLimits(userId);
    const merged = { ...current, ...limits };

    try {
      const redis = getRedis();
      await redis.set(`${LIMITS_PREFIX}${userId}`, JSON.stringify(merged), { EX: LIMITS_TTL });
    } catch (err) {
      log.warn('Failed to save spending limits', { userId, error: (err as Error).message });
    }

    return merged;
  }

  /**
   * Record a spending event and check against limits.
   * Returns alerts if any thresholds are exceeded.
   */
  async recordSpending(userId: string, amount: number): Promise<string[]> {
    const limits = await this.getLimits(userId);
    const alerts: string[] = [];

    try {
      const redis = getRedis();
      const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const weekNum = this.getWeekKey();

      const dailyKey = `${DAILY_PREFIX}${userId}:${today}`;
      const weeklyKey = `${WEEKLY_PREFIX}${userId}:${weekNum}`;

      // Increment daily and weekly counters
      const pipeline = redis.multi();
      pipeline.incrBy(dailyKey, amount);
      pipeline.expire(dailyKey, 2 * 24 * 60 * 60); // 2 days TTL
      pipeline.incrBy(weeklyKey, amount);
      pipeline.expire(weeklyKey, 8 * 24 * 60 * 60); // 8 days TTL
      const results = await pipeline.exec();

      const dailySpent = results[0] as number;
      const weeklySpent = results[2] as number;

      // Check daily limit
      if (limits.dailyLimit > 0) {
        const pct = (dailySpent / limits.dailyLimit) * 100;
        if (dailySpent > limits.dailyLimit) {
          alerts.push(`Has superado tu límite diario de ${formatCLP(limits.dailyLimit)}.`);
        } else if (pct >= limits.alertThreshold) {
          alerts.push(`Has usado ${Math.round(pct)}% de tu límite diario (${formatCLP(dailySpent)} de ${formatCLP(limits.dailyLimit)}).`);
        }
      }

      // Check weekly limit
      if (limits.weeklyLimit > 0) {
        const pct = (weeklySpent / limits.weeklyLimit) * 100;
        if (weeklySpent > limits.weeklyLimit) {
          alerts.push(`Has superado tu límite semanal de ${formatCLP(limits.weeklyLimit)}.`);
        } else if (pct >= limits.alertThreshold) {
          alerts.push(`Has usado ${Math.round(pct)}% de tu límite semanal (${formatCLP(weeklySpent)} de ${formatCLP(limits.weeklyLimit)}).`);
        }
      }
    } catch (err) {
      log.warn('Failed to record spending', { userId, error: (err as Error).message });
    }

    return alerts;
  }

  /**
   * Get current spending status for a user.
   */
  async getStatus(userId: string): Promise<SpendingStatus> {
    const limits = await this.getLimits(userId);
    let dailySpent = 0;
    let weeklySpent = 0;

    try {
      const redis = getRedis();
      const today = new Date().toISOString().slice(0, 10);
      const weekNum = this.getWeekKey();

      const [dailyStr, weeklyStr] = await Promise.all([
        redis.get(`${DAILY_PREFIX}${userId}:${today}`),
        redis.get(`${WEEKLY_PREFIX}${userId}:${weekNum}`),
      ]);

      dailySpent = dailyStr ? parseInt(dailyStr, 10) : 0;
      weeklySpent = weeklyStr ? parseInt(weeklyStr, 10) : 0;
    } catch {
      // Use defaults
    }

    const dailyRemaining = limits.dailyLimit > 0 ? Math.max(0, limits.dailyLimit - dailySpent) : Infinity;
    const weeklyRemaining = limits.weeklyLimit > 0 ? Math.max(0, limits.weeklyLimit - weeklySpent) : Infinity;

    return {
      daily: {
        spent: dailySpent,
        limit: limits.dailyLimit,
        remaining: dailyRemaining === Infinity ? -1 : dailyRemaining,
        percentage: limits.dailyLimit > 0 ? Math.min(100, Math.round((dailySpent / limits.dailyLimit) * 100)) : 0,
      },
      weekly: {
        spent: weeklySpent,
        limit: limits.weeklyLimit,
        remaining: weeklyRemaining === Infinity ? -1 : weeklyRemaining,
        percentage: limits.weeklyLimit > 0 ? Math.min(100, Math.round((weeklySpent / limits.weeklyLimit) * 100)) : 0,
      },
      alerts: [],
    };
  }

  private getWeekKey(): string {
    const now = new Date();
    const year = now.getFullYear();
    const jan1 = new Date(year, 0, 1);
    const week = Math.ceil(((now.getTime() - jan1.getTime()) / 86400000 + jan1.getDay() + 1) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
  }
}

export const spendingLimits = new SpendingLimitsService();
