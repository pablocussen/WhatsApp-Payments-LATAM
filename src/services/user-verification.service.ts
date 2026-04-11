import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-verification');

const VERIF_PREFIX = 'verif:';
const CODE_TTL = 10 * 60; // 10 minutes
const MAX_ATTEMPTS = 3;
const COOLDOWN_TTL = 60 * 60; // 1 hour after max attempts

export type VerificationType = 'EMAIL' | 'PHONE' | 'IDENTITY';
export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'FAILED' | 'EXPIRED';

export interface Verification {
  id: string;
  userId: string;
  type: VerificationType;
  target: string; // email or phone
  code: string;
  attempts: number;
  status: VerificationStatus;
  createdAt: string;
  verifiedAt: string | null;
}

export class UserVerificationService {
  /**
   * Generate and send a verification code.
   */
  async createVerification(userId: string, type: VerificationType, target: string): Promise<{ id: string; codeLength: number }> {
    // Check cooldown
    const cooldownKey = `${VERIF_PREFIX}cooldown:${userId}:${type}`;
    try {
      const redis = getRedis();
      const cooldown = await redis.get(cooldownKey);
      if (cooldown) throw new Error('Demasiados intentos. Intenta en 1 hora.');
    } catch (err) {
      if ((err as Error).message.includes('Demasiados')) throw err;
    }

    const code = this.generateCode();
    const verification: Verification = {
      id: `verif_${Date.now().toString(36)}`,
      userId,
      type,
      target,
      code,
      attempts: 0,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      verifiedAt: null,
    };

    try {
      const redis = getRedis();
      await redis.set(`${VERIF_PREFIX}${verification.id}`, JSON.stringify(verification), { EX: CODE_TTL });
    } catch (err) {
      log.warn('Failed to save verification', { userId, error: (err as Error).message });
    }

    log.info('Verification created', { userId, type, verifId: verification.id });
    return { id: verification.id, codeLength: code.length };
  }

  /**
   * Verify a code.
   */
  async verify(verifId: string, inputCode: string): Promise<{ success: boolean; error?: string }> {
    const verification = await this.get(verifId);
    if (!verification) return { success: false, error: 'Verificación no encontrada o expirada.' };
    if (verification.status !== 'PENDING') return { success: false, error: 'Verificación ya procesada.' };

    verification.attempts++;

    if (verification.code !== inputCode) {
      if (verification.attempts >= MAX_ATTEMPTS) {
        verification.status = 'FAILED';
        await this.save(verification);
        // Set cooldown
        try {
          const redis = getRedis();
          await redis.set(`${VERIF_PREFIX}cooldown:${verification.userId}:${verification.type}`, '1', { EX: COOLDOWN_TTL });
        } catch { /* ignore */ }
        return { success: false, error: 'Máximo de intentos alcanzado. Intenta en 1 hora.' };
      }
      await this.save(verification);
      return { success: false, error: `Código incorrecto. ${MAX_ATTEMPTS - verification.attempts} intentos restantes.` };
    }

    verification.status = 'VERIFIED';
    verification.verifiedAt = new Date().toISOString();
    await this.save(verification);

    log.info('Verification successful', { verifId, userId: verification.userId, type: verification.type });
    return { success: true };
  }

  /**
   * Check if user has verified a specific type.
   */
  async isVerified(userId: string, type: VerificationType): Promise<boolean> {
    try {
      const redis = getRedis();
      const val = await redis.get(`${VERIF_PREFIX}status:${userId}:${type}`);
      return val === 'true';
    } catch {
      return false;
    }
  }

  private async get(verifId: string): Promise<Verification | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${VERIF_PREFIX}${verifId}`);
      return raw ? JSON.parse(raw) as Verification : null;
    } catch {
      return null;
    }
  }

  private async save(verification: Verification): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${VERIF_PREFIX}${verification.id}`, JSON.stringify(verification), { EX: CODE_TTL });
      if (verification.status === 'VERIFIED') {
        await redis.set(`${VERIF_PREFIX}status:${verification.userId}:${verification.type}`, 'true', { EX: 365 * 24 * 60 * 60 });
      }
    } catch (err) {
      log.warn('Failed to save verification', { verifId: verification.id, error: (err as Error).message });
    }
  }

  private generateCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }
}

export const userVerification = new UserVerificationService();
