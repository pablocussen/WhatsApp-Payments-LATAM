import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('bill-split');
const BS_PREFIX = 'billsplit:';
const BS_TTL = 30 * 24 * 60 * 60;

export type SplitStatus = 'PENDING' | 'PARTIAL' | 'COMPLETED' | 'CANCELLED';
export type SplitType = 'EQUAL' | 'CUSTOM' | 'PERCENTAGE';

export interface SplitParticipant {
  phone: string;
  name: string | null;
  amountOwed: number;
  amountPaid: number;
  paid: boolean;
  paidAt: string | null;
}

export interface BillSplit {
  id: string;
  creatorId: string;
  title: string;
  totalAmount: number;
  splitType: SplitType;
  participants: SplitParticipant[];
  status: SplitStatus;
  notes: string | null;
  createdAt: string;
  completedAt: string | null;
}

export class UserBillSplitService {
  async createSplit(input: {
    creatorId: string; title: string; totalAmount: number;
    splitType: SplitType; participants: { phone: string; name?: string; amount?: number; percentage?: number }[];
  }): Promise<BillSplit> {
    if (!input.title) throw new Error('Titulo requerido.');
    if (input.totalAmount < 100) throw new Error('Monto minimo: $100.');
    if (input.participants.length < 2) throw new Error('Minimo 2 participantes.');
    if (input.participants.length > 20) throw new Error('Maximo 20 participantes.');

    const participants: SplitParticipant[] = input.participants.map(p => {
      let amountOwed = 0;
      if (input.splitType === 'EQUAL') {
        amountOwed = Math.round(input.totalAmount / input.participants.length);
      } else if (input.splitType === 'CUSTOM') {
        amountOwed = p.amount ?? 0;
      } else if (input.splitType === 'PERCENTAGE') {
        amountOwed = Math.round(input.totalAmount * ((p.percentage ?? 0) / 100));
      }
      return { phone: p.phone, name: p.name ?? null, amountOwed, amountPaid: 0, paid: false, paidAt: null };
    });

    if (input.splitType !== 'EQUAL') {
      const sum = participants.reduce((s, p) => s + p.amountOwed, 0);
      if (Math.abs(sum - input.totalAmount) > 10) throw new Error('La suma no coincide con el total.');
    }

    const split: BillSplit = {
      id: `split_${Date.now().toString(36)}`, creatorId: input.creatorId,
      title: input.title, totalAmount: input.totalAmount,
      splitType: input.splitType, participants,
      status: 'PENDING', notes: null,
      createdAt: new Date().toISOString(), completedAt: null,
    };

    try {
      const redis = getRedis();
      await redis.set(`${BS_PREFIX}${split.id}`, JSON.stringify(split), { EX: BS_TTL });
    } catch (err) { log.warn('Failed to save split', { error: (err as Error).message }); }
    log.info('Bill split created', { splitId: split.id, total: input.totalAmount });
    return split;
  }

  async recordPayment(splitId: string, phone: string, amount: number): Promise<{ success: boolean; split?: BillSplit }> {
    const split = await this.getSplit(splitId);
    if (!split) return { success: false };
    const p = split.participants.find(p => p.phone === phone);
    if (!p) return { success: false };
    if (p.paid) return { success: false };

    p.amountPaid += amount;
    if (p.amountPaid >= p.amountOwed) {
      p.paid = true;
      p.paidAt = new Date().toISOString();
    }

    const allPaid = split.participants.every(p => p.paid);
    const anyPaid = split.participants.some(p => p.paid);
    split.status = allPaid ? 'COMPLETED' : anyPaid ? 'PARTIAL' : 'PENDING';
    if (allPaid) split.completedAt = new Date().toISOString();

    try {
      const redis = getRedis();
      await redis.set(`${BS_PREFIX}${splitId}`, JSON.stringify(split), { EX: BS_TTL });
    } catch { return { success: false }; }
    return { success: true, split };
  }

  async getSplit(splitId: string): Promise<BillSplit | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${BS_PREFIX}${splitId}`);
      return raw ? JSON.parse(raw) as BillSplit : null;
    } catch { return null; }
  }

  async cancelSplit(splitId: string): Promise<boolean> {
    const split = await this.getSplit(splitId);
    if (!split || split.status === 'COMPLETED') return false;
    split.status = 'CANCELLED';
    try {
      const redis = getRedis();
      await redis.set(`${BS_PREFIX}${splitId}`, JSON.stringify(split), { EX: BS_TTL });
    } catch { return false; }
    return true;
  }

  formatSplitSummary(split: BillSplit): string {
    const paid = split.participants.filter(p => p.paid).length;
    return `${split.title}: ${formatCLP(split.totalAmount)} entre ${split.participants.length} — ${paid}/${split.participants.length} pagaron — ${split.status}`;
  }
}

export const userBillSplit = new UserBillSplitService();
