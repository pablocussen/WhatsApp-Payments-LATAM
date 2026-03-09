import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('cache');

// TTLs in seconds
const BALANCE_TTL = 30;
const PROFILE_TTL = 300; // 5 min
const RECIPIENTS_TTL = 300; // 5 min

// ─── Cache Service ──────────────────────────────────────

export class CacheService {
  // ─── Wallet Balance ─────────────────────────────────

  async getBalance(userId: string): Promise<number | null> {
    try {
      const raw = await getRedis().get(`cache:balance:${userId}`);
      return raw != null ? Number(raw) : null;
    } catch {
      return null;
    }
  }

  async setBalance(userId: string, balance: number): Promise<void> {
    try {
      await getRedis().set(`cache:balance:${userId}`, String(balance), { EX: BALANCE_TTL });
    } catch {
      // fail-open
    }
  }

  async invalidateBalance(...userIds: string[]): Promise<void> {
    try {
      const redis = getRedis();
      const keys = userIds.map((id) => `cache:balance:${id}`);
      if (keys.length > 0) await redis.del(keys);
    } catch {
      // fail-open
    }
  }

  // ─── User Profile ──────────────────────────────────

  async getUser(key: string, value: string): Promise<string | null> {
    try {
      return await getRedis().get(`cache:user:${key}:${value}`);
    } catch {
      return null;
    }
  }

  async setUser(userId: string, waId: string, json: string): Promise<void> {
    try {
      const redis = getRedis();
      await Promise.all([
        redis.set(`cache:user:id:${userId}`, json, { EX: PROFILE_TTL }),
        redis.set(`cache:user:waId:${waId}`, json, { EX: PROFILE_TTL }),
      ]);
    } catch {
      // fail-open
    }
  }

  async invalidateUser(userId: string, waId: string): Promise<void> {
    try {
      await getRedis().del([`cache:user:id:${userId}`, `cache:user:waId:${waId}`]);
    } catch {
      // fail-open
    }
  }

  // ─── Recent Recipients ─────────────────────────────

  async getRecipients(userId: string): Promise<string | null> {
    try {
      return await getRedis().get(`cache:recipients:${userId}`);
    } catch {
      return null;
    }
  }

  async setRecipients(userId: string, json: string): Promise<void> {
    try {
      await getRedis().set(`cache:recipients:${userId}`, json, { EX: RECIPIENTS_TTL });
    } catch {
      // fail-open
    }
  }

  async invalidateRecipients(userId: string): Promise<void> {
    try {
      await getRedis().del(`cache:recipients:${userId}`);
    } catch {
      // fail-open
    }
  }
}

// Singleton
export const cache = new CacheService();
