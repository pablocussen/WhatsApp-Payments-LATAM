import { randomBytes } from 'crypto';
import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('split-payment');

// ─── Types ──────────────────────────────────────────────

export type SplitStatus = 'pending' | 'partial' | 'completed' | 'cancelled';
export type ParticipantStatus = 'pending' | 'paid' | 'declined';

export interface SplitParticipant {
  userId: string | null;         // null if invited by phone only
  phone: string;
  name: string;
  amount: number;                // their share
  status: ParticipantStatus;
  paidAt: string | null;
  transactionRef: string | null;
}

export interface SplitPayment {
  id: string;
  createdBy: string;             // organizer userId
  creatorName: string;
  description: string;           // "Asado en casa de Juan"
  totalAmount: number;
  splitMethod: 'equal' | 'custom';
  participants: SplitParticipant[];
  status: SplitStatus;
  paidCount: number;
  paidAmount: number;
  createdAt: string;
  completedAt: string | null;
}

export interface CreateSplitInput {
  createdBy: string;
  creatorName: string;
  description: string;
  totalAmount: number;
  splitMethod: 'equal' | 'custom';
  participants: Array<{
    phone: string;
    name: string;
    amount?: number;             // required for 'custom', ignored for 'equal'
  }>;
}

const SPLIT_PREFIX = 'split:';
const USER_SPLITS = 'split:user:';
const PHONE_SPLITS = 'split:phone:';
const SPLIT_TTL = 30 * 24 * 60 * 60;   // 30 days
const MAX_PARTICIPANTS = 20;

// ─── Service ────────────────────────────────────────────

export class SplitPaymentService {
  /**
   * Create a new split payment.
   */
  async createSplit(input: CreateSplitInput): Promise<SplitPayment> {
    if (!input.description || input.description.length > 100) {
      throw new Error('Descripción debe tener entre 1 y 100 caracteres');
    }
    if (input.totalAmount < 200) {
      throw new Error('Monto total mínimo es $200');
    }
    if (input.totalAmount > 50_000_000) {
      throw new Error('Monto total máximo es $50.000.000');
    }
    if (!input.participants.length) {
      throw new Error('Debe incluir al menos 1 participante');
    }
    if (input.participants.length > MAX_PARTICIPANTS) {
      throw new Error(`Máximo ${MAX_PARTICIPANTS} participantes`);
    }

    // Calculate shares
    const participants: SplitParticipant[] = [];
    if (input.splitMethod === 'equal') {
      const share = Math.floor(input.totalAmount / (input.participants.length + 1)); // +1 for creator
      const remainder = input.totalAmount - share * (input.participants.length + 1);

      for (const p of input.participants) {
        participants.push({
          userId: null,
          phone: p.phone.replace(/\s/g, ''),
          name: p.name,
          amount: share,
          status: 'pending',
          paidAt: null,
          transactionRef: null,
        });
      }
      // Give remainder to first participant (avoid rounding loss)
      if (remainder > 0 && participants.length > 0) {
        participants[0].amount += remainder;
      }
    } else {
      // Custom amounts
      let customTotal = 0;
      for (const p of input.participants) {
        if (!p.amount || p.amount < 100) {
          throw new Error(`Monto de ${p.name} debe ser al menos $100`);
        }
        customTotal += p.amount;
        participants.push({
          userId: null,
          phone: p.phone.replace(/\s/g, ''),
          name: p.name,
          amount: p.amount,
          status: 'pending',
          paidAt: null,
          transactionRef: null,
        });
      }
      if (customTotal > input.totalAmount) {
        throw new Error('La suma de montos individuales supera el total');
      }
    }

    const split: SplitPayment = {
      id: `spl_${randomBytes(8).toString('hex')}`,
      createdBy: input.createdBy,
      creatorName: input.creatorName,
      description: input.description,
      totalAmount: input.totalAmount,
      splitMethod: input.splitMethod,
      participants,
      status: 'pending',
      paidCount: 0,
      paidAmount: 0,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    try {
      const redis = getRedis();
      await redis.set(`${SPLIT_PREFIX}${split.id}`, JSON.stringify(split), { EX: SPLIT_TTL });

      // Creator index
      const userKey = `${USER_SPLITS}${input.createdBy}`;
      const userRaw = await redis.get(userKey);
      const userSplits: string[] = userRaw ? JSON.parse(userRaw) : [];
      userSplits.push(split.id);
      await redis.set(userKey, JSON.stringify(userSplits), { EX: SPLIT_TTL });

      // Phone indexes (so participants can find their splits)
      for (const p of participants) {
        const phoneKey = `${PHONE_SPLITS}${p.phone}`;
        const phoneRaw = await redis.get(phoneKey);
        const phoneSplits: string[] = phoneRaw ? JSON.parse(phoneRaw) : [];
        phoneSplits.push(split.id);
        await redis.set(phoneKey, JSON.stringify(phoneSplits), { EX: SPLIT_TTL });
      }

      log.info('Split payment created', {
        id: split.id, total: split.totalAmount, participants: participants.length,
      });
    } catch (err) {
      log.warn('Failed to save split', { error: (err as Error).message });
    }

    return split;
  }

  /**
   * Get a split by ID.
   */
  async getSplit(splitId: string): Promise<SplitPayment | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${SPLIT_PREFIX}${splitId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * Get splits created by a user.
   */
  async getUserSplits(userId: string): Promise<SplitPayment[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${USER_SPLITS}${userId}`);
      if (!raw) return [];

      const ids: string[] = JSON.parse(raw);
      const splits: SplitPayment[] = [];
      for (const id of ids) {
        const s = await this.getSplit(id);
        if (s) splits.push(s);
      }
      return splits;
    } catch {
      return [];
    }
  }

  /**
   * Get splits where a phone number is a participant.
   */
  async getSplitsByPhone(phone: string): Promise<SplitPayment[]> {
    try {
      const redis = getRedis();
      const normalized = phone.replace(/\s/g, '');
      const raw = await redis.get(`${PHONE_SPLITS}${normalized}`);
      if (!raw) return [];

      const ids: string[] = JSON.parse(raw);
      const splits: SplitPayment[] = [];
      for (const id of ids) {
        const s = await this.getSplit(id);
        if (s && s.status !== 'cancelled') splits.push(s);
      }
      return splits;
    } catch {
      return [];
    }
  }

  /**
   * Record a participant's payment.
   */
  async recordPayment(
    splitId: string,
    phone: string,
    transactionRef: string,
  ): Promise<SplitPayment | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${SPLIT_PREFIX}${splitId}`);
      if (!raw) return null;

      const split: SplitPayment = JSON.parse(raw);
      const normalized = phone.replace(/\s/g, '');
      const participant = split.participants.find(
        p => p.phone === normalized && p.status === 'pending',
      );

      if (!participant) {
        throw new Error('Participante no encontrado o ya pagó');
      }

      participant.status = 'paid';
      participant.paidAt = new Date().toISOString();
      participant.transactionRef = transactionRef;

      split.paidCount = split.participants.filter(p => p.status === 'paid').length;
      split.paidAmount = split.participants
        .filter(p => p.status === 'paid')
        .reduce((sum, p) => sum + p.amount, 0);

      if (split.paidCount === split.participants.length) {
        split.status = 'completed';
        split.completedAt = new Date().toISOString();
      } else {
        split.status = 'partial';
      }

      await redis.set(`${SPLIT_PREFIX}${splitId}`, JSON.stringify(split), { EX: SPLIT_TTL });
      log.info('Split payment recorded', {
        splitId, phone: normalized, paid: split.paidCount, total: split.participants.length,
      });
      return split;
    } catch (err) {
      if ((err as Error).message.includes('Participante')) throw err;
      return null;
    }
  }

  /**
   * Decline participation.
   */
  async declineParticipation(splitId: string, phone: string): Promise<boolean> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${SPLIT_PREFIX}${splitId}`);
      if (!raw) return false;

      const split: SplitPayment = JSON.parse(raw);
      const normalized = phone.replace(/\s/g, '');
      const participant = split.participants.find(
        p => p.phone === normalized && p.status === 'pending',
      );
      if (!participant) return false;

      participant.status = 'declined';
      await redis.set(`${SPLIT_PREFIX}${splitId}`, JSON.stringify(split), { EX: SPLIT_TTL });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cancel a split (creator only).
   */
  async cancelSplit(splitId: string, userId: string): Promise<boolean> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${SPLIT_PREFIX}${splitId}`);
      if (!raw) return false;

      const split: SplitPayment = JSON.parse(raw);
      if (split.createdBy !== userId) return false;
      if (split.status === 'completed' || split.status === 'cancelled') return false;

      split.status = 'cancelled';
      await redis.set(`${SPLIT_PREFIX}${splitId}`, JSON.stringify(split), { EX: SPLIT_TTL });
      log.info('Split payment cancelled', { splitId });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get split summary text (for WhatsApp).
   */
  formatSplitSummary(split: SplitPayment): string {
    const lines: string[] = [
      `*${split.description}*`,
      `Total: ${formatCLP(split.totalAmount)}`,
      `Creado por: ${split.creatorName}`,
      '',
      `*Participantes (${split.paidCount}/${split.participants.length} pagados):*`,
    ];

    for (const p of split.participants) {
      const icon = p.status === 'paid' ? '✅' : p.status === 'declined' ? '❌' : '⏳';
      lines.push(`${icon} ${p.name}: ${formatCLP(p.amount)}`);
    }

    if (split.status === 'completed') {
      lines.push('', '🎉 *Todos pagaron!*');
    } else {
      const remaining = split.totalAmount - split.paidAmount;
      lines.push('', `Faltan: ${formatCLP(remaining)}`);
    }

    return lines.join('\n');
  }
}

export const splitPayment = new SplitPaymentService();
