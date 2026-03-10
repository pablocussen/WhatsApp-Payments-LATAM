import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('activity');

// ─── Types ──────────────────────────────────────────────

export interface ActivityEvent {
  type: 'LOGIN' | 'PAYMENT_SENT' | 'PAYMENT_RECEIVED' | 'TOPUP' | 'PROFILE_VIEW' | 'PIN_CHANGE';
  userId: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

export interface UserActivity {
  lastSeen: string | null;
  loginCount: number;
  recentEvents: ActivityEvent[];
}

const LAST_SEEN_PREFIX = 'activity:lastseen:';
const LOGIN_COUNT_PREFIX = 'activity:logins:';
const EVENTS_PREFIX = 'activity:events:';
const MAX_EVENTS = 20;
const LAST_SEEN_TTL = 30 * 24 * 60 * 60; // 30 days
const EVENTS_TTL = 90 * 24 * 60 * 60;    // 90 days

// ─── Service ────────────────────────────────────────────

export class ActivityService {
  /**
   * Record user activity (last seen + event log).
   * Fire-and-forget — never throws.
   */
  async record(event: ActivityEvent): Promise<void> {
    try {
      const redis = getRedis();
      const pipeline = redis.multi();

      // Update last seen
      pipeline.set(`${LAST_SEEN_PREFIX}${event.userId}`, event.timestamp, { EX: LAST_SEEN_TTL });

      // Increment login counter
      if (event.type === 'LOGIN') {
        pipeline.incr(`${LOGIN_COUNT_PREFIX}${event.userId}`);
      }

      // Push to events list (capped at MAX_EVENTS)
      const eventJson = JSON.stringify(event);
      pipeline.lPush(`${EVENTS_PREFIX}${event.userId}`, eventJson);
      pipeline.lTrim(`${EVENTS_PREFIX}${event.userId}`, 0, MAX_EVENTS - 1);
      pipeline.expire(`${EVENTS_PREFIX}${event.userId}`, EVENTS_TTL);

      await pipeline.exec();
    } catch (err) {
      log.warn('Failed to record activity', { userId: event.userId, error: (err as Error).message });
    }
  }

  /**
   * Get user activity summary.
   */
  async getActivity(userId: string): Promise<UserActivity> {
    try {
      const redis = getRedis();

      const [lastSeen, loginCountStr, events] = await Promise.all([
        redis.get(`${LAST_SEEN_PREFIX}${userId}`),
        redis.get(`${LOGIN_COUNT_PREFIX}${userId}`),
        redis.lRange(`${EVENTS_PREFIX}${userId}`, 0, MAX_EVENTS - 1),
      ]);

      return {
        lastSeen,
        loginCount: loginCountStr ? parseInt(loginCountStr, 10) : 0,
        recentEvents: events.map((e: string) => JSON.parse(e) as ActivityEvent),
      };
    } catch (err) {
      log.warn('Failed to get activity', { userId, error: (err as Error).message });
      return { lastSeen: null, loginCount: 0, recentEvents: [] };
    }
  }

  /**
   * Update last seen timestamp for a user.
   */
  async touch(userId: string): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${LAST_SEEN_PREFIX}${userId}`, new Date().toISOString(), { EX: LAST_SEEN_TTL });
    } catch {
      // Fail silently
    }
  }
}

export const activity = new ActivityService();
