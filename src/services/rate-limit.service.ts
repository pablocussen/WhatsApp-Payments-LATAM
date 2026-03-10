import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('rate-limit');

// ─── Types ──────────────────────────────────────────────

export interface RateLimitConfig {
  maxRequests: number;     // max requests in window
  windowSeconds: number;   // sliding window duration
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetInSeconds: number;
  total: number;
}

const RL_PREFIX = 'ratelimit:';

// Pre-configured limits per action
const DEFAULT_LIMITS: Record<string, RateLimitConfig> = {
  'payment:create': { maxRequests: 10, windowSeconds: 3600 },        // 10/hour
  'payment:refund': { maxRequests: 5, windowSeconds: 3600 },         // 5/hour
  'topup:create': { maxRequests: 5, windowSeconds: 3600 },           // 5/hour
  'auth:login': { maxRequests: 10, windowSeconds: 300 },             // 10/5min
  'auth:pin_attempt': { maxRequests: 5, windowSeconds: 900 },        // 5/15min
  'api:general': { maxRequests: 100, windowSeconds: 60 },            // 100/min
  'webhook:dispatch': { maxRequests: 50, windowSeconds: 60 },        // 50/min
  'link:create': { maxRequests: 20, windowSeconds: 3600 },           // 20/hour
};

// ─── Service ────────────────────────────────────────────

export class RateLimitService {
  private overrides = new Map<string, RateLimitConfig>();

  /**
   * Check if an action is allowed under rate limits.
   * Uses sliding window counter via Redis.
   */
  async check(action: string, identifier: string): Promise<RateLimitResult> {
    const config = this.getConfig(action);
    if (!config) {
      return { allowed: true, remaining: -1, resetInSeconds: 0, total: 0 };
    }

    const key = `${RL_PREFIX}${action}:${identifier}`;
    const now = Math.floor(Date.now() / 1000);
    const windowStart = now - config.windowSeconds;

    try {
      const redis = getRedis();

      // Sliding window: remove expired entries, add new one, count
      const pipeline = redis.multi();
      pipeline.zRemRangeByScore(key, 0, windowStart);
      pipeline.zCard(key);
      const results = await pipeline.exec();

      const currentCount = (results[1] as number) ?? 0;

      if (currentCount >= config.maxRequests) {
        // Get oldest entry to calculate reset time
        const oldest = await redis.zRange(key, 0, 0);
        let resetIn = config.windowSeconds;
        if (oldest.length > 0) {
          const oldestTime = parseInt(oldest[0], 10);
          resetIn = Math.max(1, (oldestTime + config.windowSeconds) - now);
        }

        return {
          allowed: false,
          remaining: 0,
          resetInSeconds: resetIn,
          total: currentCount,
        };
      }

      // Add this request to the window
      await redis.zAdd(key, { score: now, value: `${now}:${Math.random().toString(36).slice(2, 8)}` });
      await redis.expire(key, config.windowSeconds + 1);

      return {
        allowed: true,
        remaining: config.maxRequests - currentCount - 1,
        resetInSeconds: config.windowSeconds,
        total: currentCount + 1,
      };
    } catch (err) {
      // Fail open — don't block requests on Redis errors
      log.warn('Rate limit check failed, allowing request', { action, identifier, error: (err as Error).message });
      return { allowed: true, remaining: -1, resetInSeconds: 0, total: 0 };
    }
  }

  /**
   * Set custom rate limit for an action (overrides defaults).
   */
  setLimit(action: string, config: RateLimitConfig): void {
    if (config.maxRequests < 1) throw new Error('maxRequests debe ser >= 1');
    if (config.windowSeconds < 1) throw new Error('windowSeconds debe ser >= 1');
    this.overrides.set(action, config);
  }

  /**
   * Remove custom override, reverting to default.
   */
  removeOverride(action: string): void {
    this.overrides.delete(action);
  }

  /**
   * Get effective config for an action.
   */
  getConfig(action: string): RateLimitConfig | null {
    return this.overrides.get(action) ?? DEFAULT_LIMITS[action] ?? null;
  }

  /**
   * Reset rate limit for a specific identifier.
   */
  async reset(action: string, identifier: string): Promise<void> {
    try {
      const redis = getRedis();
      await redis.del(`${RL_PREFIX}${action}:${identifier}`);
    } catch (err) {
      log.warn('Rate limit reset failed', { action, identifier, error: (err as Error).message });
    }
  }

  /**
   * Get all configured rate limits.
   */
  getAllLimits(): Record<string, RateLimitConfig> {
    const combined = { ...DEFAULT_LIMITS };
    for (const [key, config] of this.overrides) {
      combined[key] = config;
    }
    return combined;
  }
}

export const rateLimiter = new RateLimitService();
