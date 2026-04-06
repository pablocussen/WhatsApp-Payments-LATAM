import { prisma, getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { audit } from './audit.service';

const log = createLogger('account-deletion');

const DELETION_PREFIX = 'deletion:';
const DELETION_TTL = 30 * 24 * 60 * 60; // 30 days (retention for audit)

export type DeletionStatus = 'requested' | 'processing' | 'completed' | 'cancelled';

export interface DeletionRequest {
  id: string;
  userId: string;
  waId: string;
  status: DeletionStatus;
  reason: string | null;
  requestedAt: string;
  scheduledAt: string;     // 7-day grace period
  completedAt: string | null;
  dataDeleted: string[];   // list of data types deleted
}

const GRACE_PERIOD_DAYS = 7;

export class AccountDeletionService {
  /**
   * Request account deletion. Starts a 7-day grace period
   * during which the user can cancel.
   */
  async requestDeletion(input: {
    userId: string;
    waId: string;
    reason?: string;
  }): Promise<DeletionRequest> {
    // Check for existing pending request
    const existing = await this.getPendingRequest(input.userId);
    if (existing) {
      throw new Error('Ya tienes una solicitud de eliminación pendiente.');
    }

    const now = new Date();
    const scheduledDate = new Date(now);
    scheduledDate.setDate(scheduledDate.getDate() + GRACE_PERIOD_DAYS);

    const request: DeletionRequest = {
      id: `del_${Date.now().toString(36)}`,
      userId: input.userId,
      waId: input.waId,
      status: 'requested',
      reason: input.reason ?? null,
      requestedAt: now.toISOString(),
      scheduledAt: scheduledDate.toISOString(),
      completedAt: null,
      dataDeleted: [],
    };

    const redis = getRedis();
    await redis.set(`${DELETION_PREFIX}${input.userId}`, JSON.stringify(request), { EX: DELETION_TTL });

    audit.log({
      eventType: 'ACCOUNT_DELETION_REQUESTED',
      actorType: 'USER',
      actorId: input.userId,
      targetUserId: input.userId,
      metadata: { reason: input.reason, scheduledAt: request.scheduledAt },
    });

    log.info('Account deletion requested', {
      userId: input.userId,
      scheduledAt: request.scheduledAt,
    });

    return request;
  }

  /**
   * Cancel a pending deletion request (within grace period).
   */
  async cancelDeletion(userId: string): Promise<boolean> {
    const request = await this.getPendingRequest(userId);
    if (!request) return false;

    request.status = 'cancelled';

    const redis = getRedis();
    await redis.set(`${DELETION_PREFIX}${userId}`, JSON.stringify(request), { EX: DELETION_TTL });

    audit.log({
      eventType: 'ACCOUNT_DELETION_CANCELLED',
      actorType: 'USER',
      actorId: userId,
      targetUserId: userId,
    });

    log.info('Account deletion cancelled', { userId });
    return true;
  }

  /**
   * Process a deletion request (called after grace period).
   * Removes user data from Redis and marks DB records.
   */
  async processDeletion(userId: string): Promise<DeletionRequest | null> {
    const request = await this.getPendingRequest(userId);
    if (!request || request.status !== 'requested') return null;

    // Check if grace period has passed
    if (new Date(request.scheduledAt) > new Date()) {
      return null; // Not yet
    }

    request.status = 'processing';
    const redis = getRedis();
    await redis.set(`${DELETION_PREFIX}${userId}`, JSON.stringify(request), { EX: DELETION_TTL });

    const deleted: string[] = [];

    // Delete user data from Redis
    const keysToDelete = [
      `prefs:user:${userId}`,
      `consent:${userId}:tos`,
      `consent:${userId}:privacy`,
      `consent:${userId}:messaging`,
      `consent:user:${userId}`,
      `session:${request.waId}`,
    ];

    for (const key of keysToDelete) {
      try {
        await redis.del(key);
        deleted.push(key);
      } catch { /* continue */ }
    }

    // Anonymize user in database (keep tx records for compliance, but remove PII)
    try {
      await prisma.user.update({
        where: { id: userId },
        data: {
          name: '[Eliminado]',
          rutHash: '[deleted]',
          pinHash: '[deleted]',
          biometricEnabled: false,
          pinAttempts: 0,
          lockedUntil: null,
          isActive: false,
        },
      });
      deleted.push('user.pii');
    } catch (err) {
      log.warn('Failed to anonymize user in DB', { userId, error: (err as Error).message });
    }

    request.status = 'completed';
    request.completedAt = new Date().toISOString();
    request.dataDeleted = deleted;

    await redis.set(`${DELETION_PREFIX}${userId}`, JSON.stringify(request), { EX: DELETION_TTL });

    audit.log({
      eventType: 'ACCOUNT_DELETION_COMPLETED',
      actorType: 'SYSTEM',
      targetUserId: userId,
      metadata: { dataDeleted: deleted },
    });

    log.info('Account deletion completed', { userId, deletedItems: deleted.length });
    return request;
  }

  /**
   * Get pending deletion request for a user.
   */
  async getPendingRequest(userId: string): Promise<DeletionRequest | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${DELETION_PREFIX}${userId}`);
      if (!raw) return null;
      const req = JSON.parse(raw) as DeletionRequest;
      if (req.status === 'cancelled' || req.status === 'completed') return null;
      return req;
    } catch {
      return null;
    }
  }

  /**
   * Get deletion request status.
   */
  async getStatus(userId: string): Promise<DeletionRequest | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${DELETION_PREFIX}${userId}`);
      return raw ? JSON.parse(raw) as DeletionRequest : null;
    } catch {
      return null;
    }
  }
}

export const accountDeletion = new AccountDeletionService();
