import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('analytics');

// ─── Types ──────────────────────────────────────────────

export interface DailyStats {
  date: string;
  totalAmount: number;
  transactionCount: number;
  averageAmount: number;
}

export interface UserInsights {
  totalSent: number;
  totalReceived: number;
  transactionCount: number;
  averageTransaction: number;
  topRecipients: { phone: string; count: number; totalAmount: number }[];
  byDayOfWeek: Record<string, number>;   // Mon-Sun counts
  peakHour: number;                        // 0-23
  hourDistribution: number[];             // 24 entries
}

export interface PlatformStats {
  dailyActiveUsers: number;
  weeklyActiveUsers: number;
  monthlyActiveUsers: number;
  totalVolume: number;
  transactionCount: number;
  averageTicket: number;
  topMerchants: { merchantId: string; volume: number; count: number }[];
}

const ANALYTICS_PREFIX = 'analytics:';
const DAU_KEY = 'analytics:dau:';
const WAU_KEY = 'analytics:wau:';
const MAU_KEY = 'analytics:mau:';
const INSIGHTS_PREFIX = 'analytics:insights:';
const ANALYTICS_TTL = 90 * 24 * 60 * 60; // 90 days

// ─── Service ────────────────────────────────────────────

export class AnalyticsService {
  /**
   * Track a transaction for analytics.
   */
  async trackTransaction(data: {
    senderId: string;
    receiverId: string;
    senderPhone: string;
    receiverPhone: string;
    amount: number;
    timestamp: string;
  }): Promise<void> {
    try {
      const redis = getRedis();
      const date = data.timestamp.slice(0, 10);
      const hour = new Date(data.timestamp).getHours();
      const dayOfWeek = new Date(data.timestamp).toLocaleDateString('en-US', { weekday: 'short' });

      const pipeline = redis.multi();

      // Daily volume
      pipeline.incrBy(`${ANALYTICS_PREFIX}daily:amount:${date}`, data.amount);
      pipeline.incr(`${ANALYTICS_PREFIX}daily:count:${date}`);
      pipeline.expire(`${ANALYTICS_PREFIX}daily:amount:${date}`, ANALYTICS_TTL);
      pipeline.expire(`${ANALYTICS_PREFIX}daily:count:${date}`, ANALYTICS_TTL);

      // User insights: sent/received totals
      pipeline.incrBy(`${INSIGHTS_PREFIX}${data.senderId}:sent`, data.amount);
      pipeline.incrBy(`${INSIGHTS_PREFIX}${data.receiverId}:received`, data.amount);
      pipeline.incr(`${INSIGHTS_PREFIX}${data.senderId}:count`);
      pipeline.expire(`${INSIGHTS_PREFIX}${data.senderId}:sent`, ANALYTICS_TTL);
      pipeline.expire(`${INSIGHTS_PREFIX}${data.receiverId}:received`, ANALYTICS_TTL);
      pipeline.expire(`${INSIGHTS_PREFIX}${data.senderId}:count`, ANALYTICS_TTL);

      // Hour distribution
      pipeline.incr(`${INSIGHTS_PREFIX}${data.senderId}:hour:${hour}`);
      pipeline.expire(`${INSIGHTS_PREFIX}${data.senderId}:hour:${hour}`, ANALYTICS_TTL);

      // Day of week
      pipeline.incr(`${INSIGHTS_PREFIX}${data.senderId}:dow:${dayOfWeek}`);
      pipeline.expire(`${INSIGHTS_PREFIX}${data.senderId}:dow:${dayOfWeek}`, ANALYTICS_TTL);

      // Active users tracking (using sets with date keys)
      pipeline.sAdd(`${DAU_KEY}${date}`, data.senderId);
      pipeline.expire(`${DAU_KEY}${date}`, 2 * 24 * 60 * 60);

      await pipeline.exec();

      // Top recipients (separate operation)
      await this.trackRecipient(data.senderId, data.receiverPhone, data.amount);
    } catch (err) {
      log.warn('Analytics tracking failed', { error: (err as Error).message });
    }
  }

  /**
   * Track active user for DAU/WAU/MAU.
   */
  async trackActiveUser(userId: string): Promise<void> {
    try {
      const redis = getRedis();
      const now = new Date();
      const date = now.toISOString().slice(0, 10);
      const week = `${now.getFullYear()}-W${String(Math.ceil((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000 / 7)).padStart(2, '0')}`;
      const month = date.slice(0, 7);

      const pipeline = redis.multi();
      pipeline.sAdd(`${DAU_KEY}${date}`, userId);
      pipeline.expire(`${DAU_KEY}${date}`, 2 * 24 * 60 * 60);
      pipeline.sAdd(`${WAU_KEY}${week}`, userId);
      pipeline.expire(`${WAU_KEY}${week}`, 8 * 24 * 60 * 60);
      pipeline.sAdd(`${MAU_KEY}${month}`, userId);
      pipeline.expire(`${MAU_KEY}${month}`, 35 * 24 * 60 * 60);
      await pipeline.exec();
    } catch (err) {
      log.warn('Active user tracking failed', { error: (err as Error).message });
    }
  }

  /**
   * Get daily stats for a date range.
   */
  async getDailyStats(startDate: string, endDate: string): Promise<DailyStats[]> {
    const stats: DailyStats[] = [];
    try {
      const redis = getRedis();
      const current = new Date(startDate);
      const end = new Date(endDate);

      while (current <= end) {
        const date = current.toISOString().slice(0, 10);
        const [amountStr, countStr] = await Promise.all([
          redis.get(`${ANALYTICS_PREFIX}daily:amount:${date}`),
          redis.get(`${ANALYTICS_PREFIX}daily:count:${date}`),
        ]);

        const totalAmount = amountStr ? parseInt(amountStr, 10) : 0;
        const count = countStr ? parseInt(countStr, 10) : 0;

        stats.push({
          date,
          totalAmount,
          transactionCount: count,
          averageAmount: count > 0 ? Math.round(totalAmount / count) : 0,
        });

        current.setDate(current.getDate() + 1);
      }
    } catch (err) {
      log.warn('Failed to get daily stats', { error: (err as Error).message });
    }

    return stats;
  }

  /**
   * Get insights for a specific user.
   */
  async getUserInsights(userId: string): Promise<UserInsights> {
    const defaults: UserInsights = {
      totalSent: 0, totalReceived: 0, transactionCount: 0,
      averageTransaction: 0, topRecipients: [],
      byDayOfWeek: {}, peakHour: 0, hourDistribution: new Array(24).fill(0),
    };

    try {
      const redis = getRedis();

      const [sentStr, receivedStr, countStr] = await Promise.all([
        redis.get(`${INSIGHTS_PREFIX}${userId}:sent`),
        redis.get(`${INSIGHTS_PREFIX}${userId}:received`),
        redis.get(`${INSIGHTS_PREFIX}${userId}:count`),
      ]);

      const totalSent = sentStr ? parseInt(sentStr, 10) : 0;
      const totalReceived = receivedStr ? parseInt(receivedStr, 10) : 0;
      const count = countStr ? parseInt(countStr, 10) : 0;

      // Hour distribution
      const hourDistribution: number[] = [];
      for (let h = 0; h < 24; h++) {
        const hStr = await redis.get(`${INSIGHTS_PREFIX}${userId}:hour:${h}`);
        hourDistribution.push(hStr ? parseInt(hStr, 10) : 0);
      }
      const peakHour = hourDistribution.indexOf(Math.max(...hourDistribution));

      // Day of week
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const byDayOfWeek: Record<string, number> = {};
      for (const day of days) {
        const dStr = await redis.get(`${INSIGHTS_PREFIX}${userId}:dow:${day}`);
        byDayOfWeek[day] = dStr ? parseInt(dStr, 10) : 0;
      }

      // Top recipients
      const recipientsRaw = await redis.get(`${INSIGHTS_PREFIX}${userId}:recipients`);
      const topRecipients = recipientsRaw
        ? (JSON.parse(recipientsRaw) as { phone: string; count: number; totalAmount: number }[])
            .sort((a, b) => b.totalAmount - a.totalAmount)
            .slice(0, 5)
        : [];

      return {
        totalSent, totalReceived, transactionCount: count,
        averageTransaction: count > 0 ? Math.round(totalSent / count) : 0,
        topRecipients, byDayOfWeek, peakHour, hourDistribution,
      };
    } catch {
      return defaults;
    }
  }

  /**
   * Get platform-wide active user counts.
   */
  async getActiveUserCounts(): Promise<{ dau: number; wau: number; mau: number }> {
    try {
      const redis = getRedis();
      const now = new Date();
      const date = now.toISOString().slice(0, 10);
      const week = `${now.getFullYear()}-W${String(Math.ceil((now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()) / 86400000 / 7)).padStart(2, '0')}`;
      const month = date.slice(0, 7);

      const [dau, wau, mau] = await Promise.all([
        redis.sCard(`${DAU_KEY}${date}`),
        redis.sCard(`${WAU_KEY}${week}`),
        redis.sCard(`${MAU_KEY}${month}`),
      ]);

      return { dau, wau, mau };
    } catch {
      return { dau: 0, wau: 0, mau: 0 };
    }
  }

  // ─── Helpers ────────────────────────────────────────────

  private async trackRecipient(senderId: string, receiverPhone: string, amount: number): Promise<void> {
    try {
      const redis = getRedis();
      const key = `${INSIGHTS_PREFIX}${senderId}:recipients`;
      const raw = await redis.get(key);
      const recipients: { phone: string; count: number; totalAmount: number }[] = raw ? JSON.parse(raw) : [];

      const existing = recipients.find((r) => r.phone === receiverPhone);
      if (existing) {
        existing.count += 1;
        existing.totalAmount += amount;
      } else {
        recipients.push({ phone: receiverPhone, count: 1, totalAmount: amount });
      }

      // Keep top 10
      recipients.sort((a, b) => b.totalAmount - a.totalAmount);
      const trimmed = recipients.slice(0, 10);

      await redis.set(key, JSON.stringify(trimmed), { EX: ANALYTICS_TTL });
    } catch {
      // Silent
    }
  }
}

export const analytics = new AnalyticsService();
