import { randomBytes } from 'crypto';
import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { audit } from './audit.service';

const log = createLogger('account-recovery');

const RECOVERY_PREFIX = 'recovery:';
const RECOVERY_TTL = 900; // 15 minutes
const MAX_ATTEMPTS = 3;

export interface RecoveryRequest {
  id: string;
  userId: string;
  waId: string;
  code: string;          // 6-digit verification code
  attempts: number;
  createdAt: string;
  expiresAt: string;
  used: boolean;
}

export class AccountRecoveryService {
  /**
   * Initiate account recovery — generates a 6-digit code.
   * The code should be sent via an alternative channel (SMS, email).
   */
  async initiateRecovery(userId: string, waId: string): Promise<{
    requestId: string;
    code: string;
    expiresInMinutes: number;
  }> {
    // Check for existing active request
    const existing = await this.getActiveRequest(userId);
    if (existing && !existing.used) {
      throw new Error('Ya tienes una solicitud de recuperación activa. Espera 15 minutos.');
    }

    const code = this.generateCode();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + RECOVERY_TTL * 1000);

    const request: RecoveryRequest = {
      id: `rec_${randomBytes(6).toString('hex')}`,
      userId,
      waId,
      code,
      attempts: 0,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      used: false,
    };

    const redis = getRedis();
    await redis.set(`${RECOVERY_PREFIX}${userId}`, JSON.stringify(request), { EX: RECOVERY_TTL });

    audit.log({
      eventType: 'PIN_CHANGED', // closest available event type
      actorType: 'USER',
      actorId: userId,
      targetUserId: userId,
      metadata: { action: 'recovery_initiated', requestId: request.id },
    });

    log.info('Recovery initiated', { userId, requestId: request.id });

    return {
      requestId: request.id,
      code, // In production, this would NOT be returned — sent via SMS/email
      expiresInMinutes: 15,
    };
  }

  /**
   * Verify a recovery code.
   */
  async verifyCode(userId: string, inputCode: string): Promise<{
    valid: boolean;
    message: string;
    remainingAttempts?: number;
  }> {
    const request = await this.getActiveRequest(userId);

    if (!request) {
      return { valid: false, message: 'No hay solicitud de recuperación activa.' };
    }

    if (request.used) {
      return { valid: false, message: 'Este código ya fue usado.' };
    }

    if (new Date(request.expiresAt) < new Date()) {
      return { valid: false, message: 'Código expirado. Solicita uno nuevo.' };
    }

    if (request.attempts >= MAX_ATTEMPTS) {
      return { valid: false, message: 'Máximo de intentos alcanzado. Solicita un nuevo código.' };
    }

    if (request.code !== inputCode) {
      request.attempts++;
      const remaining = MAX_ATTEMPTS - request.attempts;

      const redis = getRedis();
      await redis.set(`${RECOVERY_PREFIX}${userId}`, JSON.stringify(request), { EX: RECOVERY_TTL });

      return {
        valid: false,
        message: remaining > 0
          ? `Código incorrecto. Te quedan ${remaining} intentos.`
          : 'Código incorrecto. Máximo de intentos alcanzado.',
        remainingAttempts: remaining,
      };
    }

    // Valid code — mark as used
    request.used = true;
    const redis = getRedis();
    await redis.set(`${RECOVERY_PREFIX}${userId}`, JSON.stringify(request), { EX: RECOVERY_TTL });

    audit.log({
      eventType: 'PIN_CHANGED',
      actorType: 'USER',
      actorId: userId,
      targetUserId: userId,
      metadata: { action: 'recovery_verified', requestId: request.id },
    });

    log.info('Recovery code verified', { userId, requestId: request.id });

    return { valid: true, message: 'Código verificado. Puedes cambiar tu PIN.' };
  }

  /**
   * Get active recovery request for a user.
   */
  private async getActiveRequest(userId: string): Promise<RecoveryRequest | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${RECOVERY_PREFIX}${userId}`);
      if (!raw) return null;
      return JSON.parse(raw) as RecoveryRequest;
    } catch {
      return null;
    }
  }

  /**
   * Generate a 6-digit numeric code.
   */
  private generateCode(): string {
    const num = parseInt(randomBytes(3).toString('hex'), 16) % 1_000_000;
    return num.toString().padStart(6, '0');
  }
}

export const accountRecovery = new AccountRecoveryService();
