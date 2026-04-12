import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-notif-history');
const UNH_PREFIX = 'unotifhist:';
const UNH_TTL = 90 * 24 * 60 * 60;
const MAX_HISTORY = 100;

export interface UserNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  type: 'PAYMENT' | 'SECURITY' | 'PROMOTION' | 'SYSTEM' | 'REMINDER';
  read: boolean;
  actionUrl: string | null;
  createdAt: string;
}

export class UserNotificationHistoryService {
  async addNotification(input: Omit<UserNotification, 'id' | 'read' | 'createdAt'>): Promise<UserNotification> {
    const notif: UserNotification = { ...input, id: `unotif_${Date.now().toString(36)}`, read: false, createdAt: new Date().toISOString() };
    try {
      const redis = getRedis();
      await redis.lPush(`${UNH_PREFIX}${input.userId}`, JSON.stringify(notif));
      await redis.lTrim(`${UNH_PREFIX}${input.userId}`, 0, MAX_HISTORY - 1);
      await redis.expire(`${UNH_PREFIX}${input.userId}`, UNH_TTL);
    } catch (err) { log.warn('Failed to add notification', { error: (err as Error).message }); }
    return notif;
  }

  async getNotifications(userId: string, limit = 20): Promise<UserNotification[]> {
    try { const redis = getRedis(); const raw = await redis.lRange(`${UNH_PREFIX}${userId}`, 0, limit - 1); return raw.map(r => JSON.parse(r) as UserNotification); }
    catch { return []; }
  }

  async getUnreadCount(userId: string): Promise<number> {
    const all = await this.getNotifications(userId, MAX_HISTORY);
    return all.filter(n => !n.read).length;
  }
}

export const userNotificationHistory = new UserNotificationHistoryService();
