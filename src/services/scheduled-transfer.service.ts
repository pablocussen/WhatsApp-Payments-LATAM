import { randomBytes } from 'crypto';
import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('scheduled-transfer');

// ─── Types ──────────────────────────────────────────────

export type TransferFrequency = 'once' | 'weekly' | 'biweekly' | 'monthly';
export type ScheduledTransferStatus = 'scheduled' | 'executed' | 'failed' | 'cancelled';

export interface ScheduledTransfer {
  id: string;
  senderId: string;
  receiverPhone: string;
  receiverName: string;
  amount: number;
  description: string;
  frequency: TransferFrequency;
  scheduledDate: string;         // YYYY-MM-DD
  scheduledTime: string;         // HH:mm (Chile time)
  status: ScheduledTransferStatus;
  lastExecutedAt: string | null;
  executionCount: number;
  nextExecutionDate: string | null;
  transactionRef: string | null;
  createdAt: string;
}

export interface CreateScheduledTransferInput {
  senderId: string;
  receiverPhone: string;
  receiverName: string;
  amount: number;
  description: string;
  frequency: TransferFrequency;
  scheduledDate: string;
  scheduledTime?: string;
}

const TRANSFER_PREFIX = 'sched-tx:';
const USER_TRANSFERS = 'sched-tx:user:';
const TRANSFER_TTL = 365 * 24 * 60 * 60;
const MAX_SCHEDULED = 10;

// ─── Service ────────────────────────────────────────────

export class ScheduledTransferService {
  /**
   * Schedule a new transfer.
   */
  async schedule(input: CreateScheduledTransferInput): Promise<ScheduledTransfer> {
    if (input.amount < 100) throw new Error('Monto minimo es $100');
    if (input.amount > 50_000_000) throw new Error('Monto maximo es $50.000.000');
    if (!input.receiverPhone) throw new Error('Telefono del receptor requerido');
    if (!input.description || input.description.length > 100) {
      throw new Error('Descripcion debe tener entre 1 y 100 caracteres');
    }
    if (!input.scheduledDate || !/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledDate)) {
      throw new Error('Fecha invalida (formato YYYY-MM-DD)');
    }

    const existing = await this.getUserTransfers(input.senderId);
    const active = existing.filter(t => t.status === 'scheduled');
    if (active.length >= MAX_SCHEDULED) {
      throw new Error(`Maximo ${MAX_SCHEDULED} transferencias programadas`);
    }

    const transfer: ScheduledTransfer = {
      id: `stx_${randomBytes(8).toString('hex')}`,
      senderId: input.senderId,
      receiverPhone: input.receiverPhone.replace(/\s/g, ''),
      receiverName: input.receiverName,
      amount: input.amount,
      description: input.description,
      frequency: input.frequency,
      scheduledDate: input.scheduledDate,
      scheduledTime: input.scheduledTime ?? '09:00',
      status: 'scheduled',
      lastExecutedAt: null,
      executionCount: 0,
      nextExecutionDate: input.scheduledDate,
      transactionRef: null,
      createdAt: new Date().toISOString(),
    };

    try {
      const redis = getRedis();
      await redis.set(`${TRANSFER_PREFIX}${transfer.id}`, JSON.stringify(transfer), { EX: TRANSFER_TTL });

      const userKey = `${USER_TRANSFERS}${input.senderId}`;
      const userRaw = await redis.get(userKey);
      const userList: string[] = userRaw ? JSON.parse(userRaw) : [];
      userList.push(transfer.id);
      await redis.set(userKey, JSON.stringify(userList), { EX: TRANSFER_TTL });

      log.info('Transfer scheduled', { id: transfer.id, amount: transfer.amount, date: transfer.scheduledDate });
    } catch (err) {
      log.warn('Failed to save scheduled transfer', { error: (err as Error).message });
    }

    return transfer;
  }

  /**
   * Get a transfer by ID.
   */
  async getTransfer(transferId: string): Promise<ScheduledTransfer | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${TRANSFER_PREFIX}${transferId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * Get all transfers for a user.
   */
  async getUserTransfers(userId: string): Promise<ScheduledTransfer[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${USER_TRANSFERS}${userId}`);
      if (!raw) return [];

      const ids: string[] = JSON.parse(raw);
      const transfers: ScheduledTransfer[] = [];
      for (const id of ids) {
        const t = await this.getTransfer(id);
        if (t) transfers.push(t);
      }
      return transfers;
    } catch {
      return [];
    }
  }

  /**
   * Mark a transfer as executed.
   */
  async markExecuted(transferId: string, transactionRef: string): Promise<ScheduledTransfer | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${TRANSFER_PREFIX}${transferId}`);
      if (!raw) return null;

      const transfer: ScheduledTransfer = JSON.parse(raw);
      if (transfer.status !== 'scheduled') {
        throw new Error(`No se puede ejecutar transferencia en estado ${transfer.status}`);
      }

      transfer.lastExecutedAt = new Date().toISOString();
      transfer.executionCount += 1;
      transfer.transactionRef = transactionRef;

      if (transfer.frequency === 'once') {
        transfer.status = 'executed';
        transfer.nextExecutionDate = null;
      } else {
        transfer.nextExecutionDate = this.computeNext(transfer.frequency, transfer.scheduledDate);
        transfer.scheduledDate = transfer.nextExecutionDate;
      }

      await redis.set(`${TRANSFER_PREFIX}${transferId}`, JSON.stringify(transfer), { EX: TRANSFER_TTL });
      log.info('Transfer executed', { id: transferId, ref: transactionRef, count: transfer.executionCount });
      return transfer;
    } catch (err) {
      if ((err as Error).message.includes('No se puede')) throw err;
      return null;
    }
  }

  /**
   * Cancel a scheduled transfer.
   */
  async cancel(transferId: string, userId: string): Promise<boolean> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${TRANSFER_PREFIX}${transferId}`);
      if (!raw) return false;

      const transfer: ScheduledTransfer = JSON.parse(raw);
      if (transfer.senderId !== userId) return false;
      if (transfer.status !== 'scheduled') return false;

      transfer.status = 'cancelled';
      transfer.nextExecutionDate = null;
      await redis.set(`${TRANSFER_PREFIX}${transferId}`, JSON.stringify(transfer), { EX: TRANSFER_TTL });
      log.info('Transfer cancelled', { id: transferId });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get transfers due for execution.
   */
  getDueTransfers(transfers: ScheduledTransfer[]): ScheduledTransfer[] {
    const today = new Date().toISOString().slice(0, 10);
    return transfers.filter(t => t.status === 'scheduled' && t.nextExecutionDate && t.nextExecutionDate <= today);
  }

  // ─── Helpers ──────────────────────────────────────────

  private computeNext(frequency: TransferFrequency, currentDate: string): string {
    const date = new Date(currentDate);
    switch (frequency) {
      case 'weekly':
        date.setDate(date.getDate() + 7);
        break;
      case 'biweekly':
        date.setDate(date.getDate() + 14);
        break;
      case 'monthly':
        date.setMonth(date.getMonth() + 1);
        break;
      default:
        break;
    }
    return date.toISOString().slice(0, 10);
  }
}

export const scheduledTransfer = new ScheduledTransferService();
