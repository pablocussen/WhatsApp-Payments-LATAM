import { randomBytes } from 'crypto';
import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('disputes');

// ─── Types ──────────────────────────────────────────────

export type DisputeReason =
  | 'unauthorized'       // No reconozco este cobro
  | 'duplicate'          // Cobro duplicado
  | 'amount_mismatch'    // Monto incorrecto
  | 'service_not_received' // Servicio no recibido
  | 'other';

export type DisputeStatus =
  | 'open'
  | 'under_review'
  | 'resolved_favor_customer'
  | 'resolved_favor_merchant'
  | 'closed';

export interface Dispute {
  id: string;
  transactionRef: string;
  openedBy: string;            // userId who opened the dispute
  merchantId: string | null;
  reason: DisputeReason;
  description: string;
  status: DisputeStatus;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface CreateDisputeInput {
  transactionRef: string;
  openedBy: string;
  merchantId?: string;
  reason: DisputeReason;
  description: string;
}

const DISPUTE_PREFIX = 'dispute:';
const USER_DISPUTES_PREFIX = 'dispute:user:';
const DISPUTES_TTL = 180 * 24 * 60 * 60; // 6 months
const MAX_OPEN_DISPUTES = 5;

const VALID_REASONS: DisputeReason[] = ['unauthorized', 'duplicate', 'amount_mismatch', 'service_not_received', 'other'];

// ─── Service ────────────────────────────────────────────

export class DisputeService {
  /**
   * Open a new dispute on a transaction.
   */
  async openDispute(input: CreateDisputeInput): Promise<Dispute> {
    if (!VALID_REASONS.includes(input.reason)) {
      throw new Error('Razón de disputa inválida');
    }
    if (!input.description || input.description.length > 500) {
      throw new Error('Descripción debe tener entre 1 y 500 caracteres');
    }
    if (!input.transactionRef) {
      throw new Error('Referencia de transacción requerida');
    }

    const userDisputes = await this.getUserDisputes(input.openedBy);
    const openCount = userDisputes.filter((d) => d.status === 'open' || d.status === 'under_review').length;
    if (openCount >= MAX_OPEN_DISPUTES) {
      throw new Error(`Máximo ${MAX_OPEN_DISPUTES} disputas abiertas simultáneamente`);
    }

    // Prevent duplicate disputes on same transaction
    const existing = userDisputes.find((d) => d.transactionRef === input.transactionRef && d.status !== 'closed');
    if (existing) {
      throw new Error('Ya existe una disputa abierta para esta transacción');
    }

    const now = new Date().toISOString();
    const dispute: Dispute = {
      id: `dsp_${randomBytes(8).toString('hex')}`,
      transactionRef: input.transactionRef,
      openedBy: input.openedBy,
      merchantId: input.merchantId ?? null,
      reason: input.reason,
      description: input.description,
      status: 'open',
      resolution: null,
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
    };

    await this.saveDispute(dispute);
    await this.addToUserIndex(input.openedBy, dispute.id);

    log.info('Dispute opened', {
      disputeId: dispute.id,
      transactionRef: input.transactionRef,
      reason: input.reason,
    });

    return dispute;
  }

  /**
   * Get a dispute by ID.
   */
  async getDispute(disputeId: string): Promise<Dispute | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${DISPUTE_PREFIX}${disputeId}`);
      if (!raw) return null;
      return JSON.parse(raw) as Dispute;
    } catch {
      return null;
    }
  }

  /**
   * Get all disputes for a user.
   */
  async getUserDisputes(userId: string): Promise<Dispute[]> {
    try {
      const redis = getRedis();
      const idsRaw = await redis.get(`${USER_DISPUTES_PREFIX}${userId}`);
      if (!idsRaw) return [];

      const ids = JSON.parse(idsRaw) as string[];
      const disputes: Dispute[] = [];

      for (const id of ids) {
        const dispute = await this.getDispute(id);
        if (dispute) disputes.push(dispute);
      }

      return disputes;
    } catch {
      return [];
    }
  }

  /**
   * Update dispute status (admin action).
   */
  async updateStatus(disputeId: string, status: DisputeStatus, resolution?: string): Promise<Dispute | null> {
    const dispute = await this.getDispute(disputeId);
    if (!dispute) return null;

    if (dispute.status === 'closed') {
      return null; // Cannot reopen closed disputes
    }

    dispute.status = status;
    dispute.updatedAt = new Date().toISOString();

    if (resolution) {
      dispute.resolution = resolution;
    }

    if (status === 'resolved_favor_customer' || status === 'resolved_favor_merchant' || status === 'closed') {
      dispute.resolvedAt = new Date().toISOString();
    }

    await this.saveDispute(dispute);

    log.info('Dispute status updated', { disputeId, status, resolution });
    return dispute;
  }

  /**
   * Close a dispute.
   */
  async closeDispute(disputeId: string, resolution: string): Promise<Dispute | null> {
    return this.updateStatus(disputeId, 'closed', resolution);
  }

  // ─── Helpers ────────────────────────────────────────────

  private async saveDispute(dispute: Dispute): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${DISPUTE_PREFIX}${dispute.id}`, JSON.stringify(dispute), { EX: DISPUTES_TTL });
    } catch (err) {
      log.warn('Failed to save dispute', { disputeId: dispute.id, error: (err as Error).message });
    }
  }

  private async addToUserIndex(userId: string, disputeId: string): Promise<void> {
    try {
      const redis = getRedis();
      const idsRaw = await redis.get(`${USER_DISPUTES_PREFIX}${userId}`);
      const ids: string[] = idsRaw ? JSON.parse(idsRaw) : [];
      ids.push(disputeId);
      await redis.set(`${USER_DISPUTES_PREFIX}${userId}`, JSON.stringify(ids), { EX: DISPUTES_TTL });
    } catch (err) {
      log.warn('Failed to update dispute index', { userId, error: (err as Error).message });
    }
  }
}

export const disputes = new DisputeService();
