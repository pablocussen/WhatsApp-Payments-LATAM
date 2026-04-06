import { Request, Response, NextFunction } from 'express';
import { createLogger } from '../config/logger';

const log = createLogger('idempotency');

const IDEMPOTENCY_TTL = 24 * 60 * 60; // 24 hours
const IDEMPOTENCY_PREFIX = 'idem:';

/**
 * Idempotency middleware for payment operations.
 *
 * Client sends `Idempotency-Key: <uuid>` header. If the same key was used
 * before, returns the cached response instead of processing again.
 * Prevents double-charges on network retries.
 *
 * Usage: apply to POST routes that create transactions.
 */
export function idempotency() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const key = req.headers['idempotency-key'] as string | undefined;

    // No key → proceed normally (backwards compatible)
    if (!key) return next();

    // Validate key format (UUID-like, 10-64 chars)
    if (key.length < 10 || key.length > 64) {
      return res.status(400).json({ error: 'Idempotency-Key debe tener entre 10 y 64 caracteres.' });
    }

    let redis: import('redis').RedisClientType | undefined;
    try {
      const { getRedis } = await import('../config/database');
      redis = getRedis() as import('redis').RedisClientType;
    } catch {
      return next(); // Redis down → fail open
    }

    const redisKey = `${IDEMPOTENCY_PREFIX}${key}`;

    try {
      // Check if key exists
      const cached = await redis.get(redisKey);

      if (cached) {
        const { statusCode, body } = JSON.parse(cached) as { statusCode: number; body: unknown };
        log.info('Idempotency cache hit', { key: key.slice(0, 16), statusCode });
        res.setHeader('X-Idempotency-Replayed', 'true');
        return res.status(statusCode).json(body);
      }

      // Intercept response to cache it
      const originalJson = res.json.bind(res);
      res.json = (body: unknown) => {
        // Cache the response (fire and forget)
        const entry = JSON.stringify({ statusCode: res.statusCode, body });
        redis!.set(redisKey, entry, { EX: IDEMPOTENCY_TTL }).catch(() => {});
        return originalJson(body);
      };

      return next();
    } catch (err) {
      log.warn('Idempotency check failed', { error: (err as Error).message });
      return next(); // Fail open
    }
  };
}
