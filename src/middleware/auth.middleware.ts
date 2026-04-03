import { Request, Response, NextFunction } from 'express';
import { compare } from 'bcrypt';
import type { RedisClientType } from 'redis';

// ─── PIN Validation ─────────────────────────────────────

const MAX_PIN_ATTEMPTS = 3;

export function isSecurePin(pin: string): boolean {
  if (pin.length !== 6) return false;
  if (!/^\d{6}$/.test(pin)) return false;
  if (/^(\d)\1{5}$/.test(pin)) return false;
  if (/^(012345|123456|234567|345678|456789|567890)$/.test(pin)) return false;
  if (/^(098765|987654|876543|765432|654321|543210)$/.test(pin)) return false;
  return true;
}

export async function verifyPin(
  inputPin: string,
  storedHash: string,
  currentAttempts: number,
  lockedUntil: Date | null,
): Promise<{ success: boolean; shouldLock: boolean; message: string }> {
  // Check if account is currently locked
  if (lockedUntil && new Date() < lockedUntil) {
    const remainingMinutes = Math.ceil((lockedUntil.getTime() - Date.now()) / 60_000);
    return {
      success: false,
      shouldLock: false,
      message: `Cuenta bloqueada. Intenta en ${remainingMinutes} minutos.`,
    };
  }

  const isValid = await compare(inputPin, storedHash);

  if (isValid) {
    return { success: true, shouldLock: false, message: 'PIN válido' };
  }

  const newAttempts = currentAttempts + 1;
  const remainingAttempts = MAX_PIN_ATTEMPTS - newAttempts;

  if (remainingAttempts <= 0) {
    return {
      success: false,
      shouldLock: true,
      message: 'Cuenta bloqueada por seguridad. Contacta soporte: /soporte',
    };
  }

  return {
    success: false,
    shouldLock: false,
    message: `PIN incorrecto. Te quedan ${remainingAttempts} intentos.`,
  };
}

// ─── Rate Limiting (Redis-backed, works across instances) ─

export function rateLimit(maxRequests: number, windowMs: number) {
  const windowSec = Math.ceil(windowMs / 1000);

  return async (req: Request, res: Response, next: NextFunction) => {
    const key = `rl:${req.ip || 'unknown'}`;

    let redis: RedisClientType | undefined;
    try {
      const { getRedis } = await import('../config/database');
      redis = getRedis() as RedisClientType;
    } catch {
      // Redis not connected yet (startup), fall through
      return next();
    }

    try {
      // Atomic INCR + EXPIRE to prevent zombie keys
      const results = await redis.multi().incr(key).expire(key, windowSec).exec();

      const count = results[0] as number;

      if (count > maxRequests) {
        return res.status(429).json({
          error: 'Demasiadas solicitudes. Intenta en unos minutos.',
        });
      }

      return next();
    } catch {
      // If Redis fails, allow the request through (fail-open)
      return next();
    }
  };
}

// ─── Granular Rate Limiting (per-action) ────────────────

export interface RateLimitConfig {
  maxRequests: number;
  windowSeconds: number;
}

/**
 * Default rate limits per action category.
 * Tighter limits on sensitive operations (auth, payments),
 * looser on reads and public endpoints.
 */
export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  'auth:register':   { maxRequests: 3,   windowSeconds: 3600 },  // 3/hour
  'auth:login':      { maxRequests: 5,   windowSeconds: 60 },    // 5/min
  'payment:create':  { maxRequests: 10,  windowSeconds: 60 },    // 10/min
  'payment:refund':  { maxRequests: 3,   windowSeconds: 300 },   // 3/5min
  'topup:create':    { maxRequests: 5,   windowSeconds: 300 },   // 5/5min
  'waitlist:join':   { maxRequests: 5,   windowSeconds: 3600 },  // 5/hour
  'kyc:upload':      { maxRequests: 10,  windowSeconds: 3600 },  // 10/hour
  'dispute:create':  { maxRequests: 3,   windowSeconds: 3600 },  // 3/hour
  'qr:generate':     { maxRequests: 20,  windowSeconds: 60 },    // 20/min
  'split:create':    { maxRequests: 10,  windowSeconds: 60 },    // 10/min
  'transfer:create': { maxRequests: 10,  windowSeconds: 60 },    // 10/min
  'request:create':  { maxRequests: 10,  windowSeconds: 60 },    // 10/min
  'link:create':     { maxRequests: 20,  windowSeconds: 60 },    // 20/min
  'admin:read':      { maxRequests: 60,  windowSeconds: 60 },    // 60/min
  'admin:write':     { maxRequests: 30,  windowSeconds: 60 },    // 30/min
  'public:read':     { maxRequests: 60,  windowSeconds: 60 },    // 60/min
};

/**
 * Granular rate limiter middleware.
 * Uses a composite key: `rl:{action}:{ip}` so each action has its own counter.
 */
export function rateLimitAction(action: string) {
  const config = RATE_LIMITS[action];
  if (!config) {
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  return async (req: Request, res: Response, next: NextFunction) => {
    const key = `rl:${action}:${req.ip || 'unknown'}`;

    let redis: RedisClientType | undefined;
    try {
      const { getRedis } = await import('../config/database');
      redis = getRedis() as RedisClientType;
    } catch {
      return next();
    }

    try {
      const results = await redis.multi().incr(key).expire(key, config.windowSeconds).exec();
      const count = results[0] as number;

      res.setHeader('X-RateLimit-Limit', config.maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, config.maxRequests - count));
      res.setHeader('X-RateLimit-Action', action);

      if (count > config.maxRequests) {
        res.setHeader('Retry-After', config.windowSeconds);
        return res.status(429).json({
          error: 'Demasiadas solicitudes. Intenta en unos minutos.',
          action,
          retryAfterSeconds: config.windowSeconds,
        });
      }

      return next();
    } catch {
      return next();
    }
  };
}
