import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('activity-feed');

const FEED_PREFIX = 'feed:';
const FEED_TTL = 90 * 24 * 60 * 60;
const MAX_FEED_ITEMS = 100;

export type ActivityType =
  | 'LOGIN' | 'PAYMENT_SENT' | 'PAYMENT_RECEIVED'
  | 'TOPUP' | 'WITHDRAWAL' | 'PIN_CHANGED'
  | 'KYC_UPDATED' | 'PROFILE_UPDATED' | 'DEVICE_ADDED'
  | 'REFERRAL_SENT' | 'REFERRAL_COMPLETED' | 'BUDGET_ALERT'
  | 'DISPUTE_OPENED' | 'DISPUTE_RESOLVED' | 'SESSION_REVOKED';

export interface FeedItem {
  id: string;
  userId: string;
  type: ActivityType;
  title: string;
  detail: string | null;
  amount: number | null;
  relatedId: string | null;
  ipAddress: string | null;
  timestamp: string;
}

const TYPE_ICONS: Record<ActivityType, string> = {
  LOGIN: '🔑',
  PAYMENT_SENT: '💸',
  PAYMENT_RECEIVED: '💰',
  TOPUP: '📥',
  WITHDRAWAL: '📤',
  PIN_CHANGED: '🔒',
  KYC_UPDATED: '🪪',
  PROFILE_UPDATED: '👤',
  DEVICE_ADDED: '📱',
  REFERRAL_SENT: '📨',
  REFERRAL_COMPLETED: '🎉',
  BUDGET_ALERT: '⚠️',
  DISPUTE_OPENED: '🔴',
  DISPUTE_RESOLVED: '🟢',
  SESSION_REVOKED: '🚫',
};

export class ActivityFeedService {
  /**
   * Add an item to the user's activity feed.
   */
  async addItem(input: {
    userId: string;
    type: ActivityType;
    title: string;
    detail?: string;
    amount?: number;
    relatedId?: string;
    ipAddress?: string;
  }): Promise<FeedItem> {
    const item: FeedItem = {
      id: `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      userId: input.userId,
      type: input.type,
      title: input.title,
      detail: input.detail ?? null,
      amount: input.amount ?? null,
      relatedId: input.relatedId ?? null,
      ipAddress: input.ipAddress ?? null,
      timestamp: new Date().toISOString(),
    };

    try {
      const redis = getRedis();
      const key = `${FEED_PREFIX}${input.userId}`;
      await redis.lPush(key, JSON.stringify(item));
      await redis.lTrim(key, 0, MAX_FEED_ITEMS - 1);
      await redis.expire(key, FEED_TTL);
    } catch (err) {
      log.warn('Failed to add feed item', { userId: input.userId, error: (err as Error).message });
    }

    return item;
  }

  /**
   * Get user's activity feed.
   */
  async getFeed(userId: string, limit = 20, offset = 0): Promise<FeedItem[]> {
    try {
      const redis = getRedis();
      const raw = await redis.lRange(`${FEED_PREFIX}${userId}`, offset, offset + limit - 1);
      return raw.map(r => JSON.parse(r) as FeedItem);
    } catch {
      return [];
    }
  }

  /**
   * Get feed filtered by type.
   */
  async getFeedByType(userId: string, type: ActivityType, limit = 20): Promise<FeedItem[]> {
    const all = await this.getFeed(userId, MAX_FEED_ITEMS);
    return all.filter(item => item.type === type).slice(0, limit);
  }

  /**
   * Get feed count.
   */
  async getFeedCount(userId: string): Promise<number> {
    try {
      const redis = getRedis();
      return await redis.lLen(`${FEED_PREFIX}${userId}`);
    } catch {
      return 0;
    }
  }

  /**
   * Get icon for activity type.
   */
  getIcon(type: ActivityType): string {
    return TYPE_ICONS[type] ?? '📋';
  }

  /**
   * Format a feed item for display.
   */
  formatItem(item: FeedItem): string {
    const icon = this.getIcon(item.type);
    const time = new Date(item.timestamp).toLocaleString('es-CL', { timeZone: 'America/Santiago' });
    const parts = [`${icon} ${item.title}`];
    if (item.detail) parts.push(item.detail);
    parts.push(time);
    return parts.join(' — ');
  }
}

export const activityFeed = new ActivityFeedService();
