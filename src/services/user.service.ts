import { prisma } from '../config/database';
import type { Prisma } from '@prisma/client';
import { createLogger } from '../config/logger';
import { hashPin, verifyPinHash, validateRut, cleanRut, hmacHash, encrypt } from '../utils/crypto';
import { isSecurePin } from '../middleware/auth.middleware';

const log = createLogger('user-service');

// ─── Types ──────────────────────────────────────────────

export interface CreateUserInput {
  waId: string; // WhatsApp ID (phone number)
  rut: string; // Chilean RUT
  name?: string;
  pin: string; // 6-digit PIN
}

export interface UserProfile {
  id: string;
  waId: string;
  name: string | null;
  kycLevel: string;
  biometricEnabled: boolean;
  createdAt: Date;
}

// ─── User Service ───────────────────────────────────────

export class UserService {
  private encryptionKey: Buffer;

  constructor(encryptionKeyHex?: string) {
    // In production, this comes from Cloud KMS
    this.encryptionKey = Buffer.from(
      encryptionKeyHex || process.env.ENCRYPTION_KEY_HEX || '0'.repeat(64),
      'hex',
    );
  }

  async createUser(
    input: CreateUserInput,
  ): Promise<{ success: boolean; userId?: string; error?: string }> {
    // Validate RUT
    const rut = cleanRut(input.rut);
    if (!validateRut(rut)) {
      return { success: false, error: 'RUT inválido. Verifica e intenta de nuevo.' };
    }

    // Validate PIN
    if (!isSecurePin(input.pin)) {
      return {
        success: false,
        error: 'PIN inseguro. No uses secuencias (123456) ni números repetidos (111111).',
      };
    }

    const rutHashValue = hmacHash(rut, this.encryptionKey);

    // Compute these before the transaction to minimize lock time
    const pinHash = await hashPin(input.pin);
    const encryptedRut = encrypt(rut, this.encryptionKey);

    // Uniqueness checks AND user creation in a single transaction to prevent
    // race conditions where two concurrent requests register the same phone/RUT
    let user;
    try {
      user = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        const existingByPhone = await tx.user.findUnique({ where: { waId: input.waId } });
        if (existingByPhone) {
          throw Object.assign(new Error('Este número ya tiene una cuenta WhatPay.'), {
            __conflict: true,
          });
        }

        const existingByRut = await tx.user.findUnique({ where: { rutHash: rutHashValue } });
        if (existingByRut) {
          throw Object.assign(new Error('Este RUT ya está registrado en WhatPay.'), {
            __conflict: true,
          });
        }

        const newUser = await tx.user.create({
          data: {
            waId: input.waId,
            rut: encryptedRut,
            rutHash: rutHashValue,
            name: input.name || null,
            pinHash,
            kycLevel: 'BASIC',
          },
        });

        await tx.wallet.create({
          data: { userId: newUser.id, balance: 0, currency: 'CLP' },
        });

        return newUser;
      });
    } catch (err: unknown) {
      const error = err as Error & { __conflict?: boolean; code?: string };
      if (error.__conflict) {
        return { success: false, error: error.message };
      }
      // P2002 = unique constraint violation (race condition fallback)
      if (error.code === 'P2002') {
        return { success: false, error: 'El número o RUT ya está registrado.' };
      }
      throw err;
    }

    log.info('User created', { userId: user.id, kycLevel: 'BASIC' });

    return { success: true, userId: user.id };
  }

  async getUserByWaId(waId: string): Promise<UserProfile | null> {
    const user = await prisma.user.findUnique({
      where: { waId },
      select: {
        id: true,
        waId: true,
        name: true,
        kycLevel: true,
        biometricEnabled: true,
        createdAt: true,
      },
    });
    return user;
  }

  async getUserById(id: string): Promise<UserProfile | null> {
    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        waId: true,
        name: true,
        kycLevel: true,
        biometricEnabled: true,
        createdAt: true,
      },
    });
    return user;
  }

  async verifyUserPin(waId: string, pin: string): Promise<{ success: boolean; message: string }> {
    const user = await prisma.user.findUnique({
      where: { waId },
      select: { id: true, pinHash: true, pinAttempts: true, lockedUntil: true },
    });

    if (!user) {
      return { success: false, message: 'Usuario no encontrado.' };
    }

    // Check lockout
    if (user.lockedUntil && new Date() < user.lockedUntil) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      return { success: false, message: `Cuenta bloqueada. Intenta en ${mins} minutos.` };
    }

    const isValid = await verifyPinHash(pin, user.pinHash);

    if (isValid) {
      // Reset attempts on success
      await prisma.user.update({
        where: { id: user.id },
        data: { pinAttempts: 0, lockedUntil: null },
      });
      return { success: true, message: 'OK' };
    }

    // Failed attempt
    const newAttempts = user.pinAttempts + 1;
    const shouldLock = newAttempts >= 3;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        pinAttempts: shouldLock ? 0 : newAttempts,
        lockedUntil: shouldLock ? new Date(Date.now() + 15 * 60 * 1000) : null,
      },
    });

    if (shouldLock) {
      log.warn('Account locked', { userId: user.id, reason: 'max_pin_attempts' });
      return {
        success: false,
        message: 'Cuenta bloqueada por seguridad (15 min). Si no fuiste tú, contacta /soporte.',
      };
    }

    const remaining = 3 - newAttempts;
    return { success: false, message: `PIN incorrecto. Te quedan ${remaining} intentos.` };
  }

  async changePin(
    waId: string,
    currentPin: string,
    newPin: string,
  ): Promise<{ success: boolean; message: string }> {
    const verify = await this.verifyUserPin(waId, currentPin);
    if (!verify.success) return verify;

    if (!isSecurePin(newPin)) {
      return { success: false, message: 'El nuevo PIN es inseguro. Elige otro.' };
    }

    const newHash = await hashPin(newPin);
    await prisma.user.update({
      where: { waId },
      data: { pinHash: newHash, pinAttempts: 0, lockedUntil: null },
    });

    log.info('PIN changed', { waId });
    return { success: true, message: 'PIN actualizado correctamente.' };
  }

  async setNewPin(waId: string, newPin: string): Promise<void> {
    if (!isSecurePin(newPin)) throw new Error('PIN inseguro.');
    const newHash = await hashPin(newPin);
    await prisma.user.update({
      where: { waId },
      data: { pinHash: newHash, pinAttempts: 0, lockedUntil: null },
    });
    log.info('PIN set via bot flow', { waId });
  }

  async updateKycLevel(userId: string, level: 'BASIC' | 'INTERMEDIATE' | 'FULL'): Promise<void> {
    await prisma.user.update({
      where: { id: userId },
      data: { kycLevel: level },
    });
    log.info('KYC level updated', { userId, level });
  }

  async getUserCount(): Promise<number> {
    return prisma.user.count({ where: { isActive: true } });
  }
}
