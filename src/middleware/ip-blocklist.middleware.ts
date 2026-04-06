import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../config/logger';

const log = createLogger('ip-blocklist');

const BLOCKLIST_PREFIX = 'blocklist:ip:';
const STRIKE_PREFIX = 'strikes:ip:';
const BLOCK_DURATION = 3600;       // 1 hour block
const MAX_STRIKES = 5;             // Block after 5 rate-limit violations
const STRIKE_WINDOW = 600;         // 10 minute window for strikes

/**
 * Record a rate-limit violation for an IP. If it exceeds MAX_STRIKES
 * in STRIKE_WINDOW, the IP gets blocked for BLOCK_DURATION.
 */
export async function recordStrike(ip: string): Promise<boolean> {
  try {
    const { getRedis } = await import('../config/database');
    const redis = getRedis() as import('redis').RedisClientType;

    const key = `${STRIKE_PREFIX}${ip}`;
    const strikes = await redis.incr(key);

    if (strikes === 1) {
      await redis.expire(key, STRIKE_WINDOW);
    }

    if (strikes >= MAX_STRIKES) {
      await redis.set(`${BLOCKLIST_PREFIX}${ip}`, new Date().toISOString(), { EX: BLOCK_DURATION });
      await redis.del(key);
      log.warn('IP blocked', { ip, strikes, blockDuration: BLOCK_DURATION });
      return true; // IP was blocked
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Middleware that checks if the requesting IP is blocked.
 * Returns 403 for blocked IPs.
 */
export function ipBlocklist() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || 'unknown';

    try {
      const { getRedis } = await import('../config/database');
      const redis = getRedis() as import('redis').RedisClientType;

      const blocked = await redis.get(`${BLOCKLIST_PREFIX}${ip}`);

      if (blocked) {
        log.info('Blocked IP attempted access', { ip });
        return res.status(403).json({
          error: 'Acceso bloqueado temporalmente por actividad sospechosa.',
          blockedAt: blocked,
        });
      }
    } catch {
      // Fail open
    }

    return next();
  };
}

/**
 * Check if an IP is currently blocked.
 */
export async function isBlocked(ip: string): Promise<boolean> {
  try {
    const { getRedis } = await import('../config/database');
    const redis = getRedis() as import('redis').RedisClientType;
    return (await redis.get(`${BLOCKLIST_PREFIX}${ip}`)) !== null;
  } catch {
    return false;
  }
}

/**
 * Manually unblock an IP (admin action).
 */
export async function unblockIp(ip: string): Promise<boolean> {
  try {
    const { getRedis } = await import('../config/database');
    const redis = getRedis() as import('redis').RedisClientType;
    const result = await redis.del(`${BLOCKLIST_PREFIX}${ip}`);
    if (result > 0) {
      log.info('IP manually unblocked', { ip });
    }
    return result > 0;
  } catch {
    return false;
  }
}
