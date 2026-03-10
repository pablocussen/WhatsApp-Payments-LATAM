import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('notification-prefs');

// ─── Types ──────────────────────────────────────────────

export interface NotificationPrefs {
  enabled: boolean;           // global opt-out toggle
  quietHoursEnabled: boolean;
  quietStart: number;         // 0-23 (hour in Chile time, default 23)
  quietEnd: number;           // 0-23 (hour in Chile time, default 7)
}

const DEFAULTS: NotificationPrefs = {
  enabled: true,
  quietHoursEnabled: false,
  quietStart: 23,
  quietEnd: 7,
};

const KEY_PREFIX = 'notif-prefs:';
const TTL = 90 * 24 * 60 * 60; // 90 days

// ─── Service ────────────────────────────────────────────

export class NotificationPrefsService {
  private key(userId: string): string {
    return `${KEY_PREFIX}${userId}`;
  }

  async get(userId: string): Promise<NotificationPrefs> {
    try {
      const redis = getRedis();
      const raw = await redis.get(this.key(userId));
      if (!raw) return { ...DEFAULTS };
      return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  async set(userId: string, prefs: Partial<NotificationPrefs>): Promise<NotificationPrefs> {
    const current = await this.get(userId);
    const merged = { ...current, ...prefs };

    try {
      const redis = getRedis();
      await redis.set(this.key(userId), JSON.stringify(merged), { EX: TTL });
    } catch (err) {
      log.warn('Failed to save notification prefs', { userId, error: (err as Error).message });
    }

    return merged;
  }

  async toggleEnabled(userId: string): Promise<NotificationPrefs> {
    const current = await this.get(userId);
    return this.set(userId, { enabled: !current.enabled });
  }

  async setQuietHours(userId: string, start: number, end: number): Promise<NotificationPrefs> {
    if (start < 0 || start > 23 || end < 0 || end > 23) {
      throw new Error('Las horas deben estar entre 0 y 23');
    }
    return this.set(userId, { quietHoursEnabled: true, quietStart: start, quietEnd: end });
  }

  async disableQuietHours(userId: string): Promise<NotificationPrefs> {
    return this.set(userId, { quietHoursEnabled: false });
  }

  /**
   * Check if a notification should be delivered right now.
   * Returns false if user opted out or if current time is in quiet hours.
   */
  async shouldNotify(userId: string): Promise<boolean> {
    const prefs = await this.get(userId);

    if (!prefs.enabled) return false;

    if (prefs.quietHoursEnabled) {
      // Get current hour in Chile time (America/Santiago)
      const now = new Date();
      const chileHour = Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/Santiago',
          hour: 'numeric',
          hour12: false,
        }).format(now),
      );

      if (prefs.quietStart > prefs.quietEnd) {
        // Spans midnight: e.g., 23-7 means quiet from 23:00 to 07:00
        if (chileHour >= prefs.quietStart || chileHour < prefs.quietEnd) return false;
      } else {
        // Same day: e.g., 14-16 means quiet from 14:00 to 16:00
        if (chileHour >= prefs.quietStart && chileHour < prefs.quietEnd) return false;
      }
    }

    return true;
  }
}

export const notificationPrefs = new NotificationPrefsService();
