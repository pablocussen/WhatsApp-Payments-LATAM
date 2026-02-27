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
