import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-receipt-archive');
const PREFIX = 'user:receipt-archive:';
const TTL = 365 * 24 * 60 * 60;

export type ArchiveReason = 'TAX' | 'WARRANTY' | 'REFERENCE' | 'EXPENSE_REPORT' | 'OTHER';

export interface ArchivedReceipt {
  id: string;
  userId: string;
  transactionId: string;
  merchantName: string;
  amount: number;
  transactionDate: string;
  reason: ArchiveReason;
  notes?: string;
  tags: string[];
  starred: boolean;
  archivedAt: string;
}

export class UserReceiptArchiveService {
  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  async list(userId: string): Promise<ArchivedReceipt[]> {
    const raw = await getRedis().get(this.key(userId));
    return raw ? JSON.parse(raw) : [];
  }

  async archive(input: {
    userId: string;
    transactionId: string;
    merchantName: string;
    amount: number;
    transactionDate: string;
    reason: ArchiveReason;
    notes?: string;
    tags?: string[];
  }): Promise<ArchivedReceipt> {
    if (input.amount <= 0) throw new Error('Monto debe ser positivo');
    if (input.merchantName.length > 80) throw new Error('Nombre de comercio excede 80 caracteres');
    if (input.notes && input.notes.length > 500) throw new Error('Notas exceden 500 caracteres');
    const list = await this.list(input.userId);
    if (list.some(r => r.transactionId === input.transactionId)) {
      throw new Error('Transaccion ya archivada');
    }
    if (list.length >= 500) throw new Error('Maximo 500 recibos archivados');
    const receipt: ArchivedReceipt = {
      id: `rcp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: input.userId,
      transactionId: input.transactionId,
      merchantName: input.merchantName,
      amount: input.amount,
      transactionDate: input.transactionDate,
      reason: input.reason,
      notes: input.notes,
      tags: input.tags ?? [],
      starred: false,
      archivedAt: new Date().toISOString(),
    };
    list.push(receipt);
    await getRedis().set(this.key(input.userId), JSON.stringify(list), { EX: TTL });
    log.info('receipt archived', { id: receipt.id, reason: receipt.reason });
    return receipt;
  }

  async toggleStar(userId: string, id: string): Promise<ArchivedReceipt | null> {
    const list = await this.list(userId);
    const receipt = list.find(r => r.id === id);
    if (!receipt) return null;
    receipt.starred = !receipt.starred;
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return receipt;
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const list = await this.list(userId);
    const idx = list.findIndex(r => r.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return true;
  }

  async getByReason(userId: string, reason: ArchiveReason): Promise<ArchivedReceipt[]> {
    const list = await this.list(userId);
    return list.filter(r => r.reason === reason);
  }

  async getStarred(userId: string): Promise<ArchivedReceipt[]> {
    const list = await this.list(userId);
    return list.filter(r => r.starred);
  }

  async getByDateRange(userId: string, from: string, to: string): Promise<ArchivedReceipt[]> {
    const list = await this.list(userId);
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    return list.filter(r => {
      const ms = new Date(r.transactionDate).getTime();
      return ms >= fromMs && ms <= toMs;
    });
  }

  async getTaxSummary(userId: string, year: number): Promise<{ count: number; total: number }> {
    const list = await this.list(userId);
    const taxReceipts = list.filter(r => {
      if (r.reason !== 'TAX') return false;
      return new Date(r.transactionDate).getUTCFullYear() === year;
    });
    return {
      count: taxReceipts.length,
      total: taxReceipts.reduce((sum, r) => sum + r.amount, 0),
    };
  }
}

export const userReceiptArchive = new UserReceiptArchiveService();
