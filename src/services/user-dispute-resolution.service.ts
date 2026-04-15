import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-dispute-resolution');
const PREFIX = 'user:dispute-resolution:';
const TTL = 365 * 24 * 60 * 60;

export type DisputeCategory = 'UNAUTHORIZED' | 'WRONG_AMOUNT' | 'WRONG_RECIPIENT' | 'NOT_DELIVERED' | 'DUPLICATE' | 'FRAUD';
export type DisputeStatus = 'OPEN' | 'IN_REVIEW' | 'RESOLVED_USER' | 'RESOLVED_MERCHANT' | 'CLOSED_NO_ACTION' | 'ESCALATED';

export interface DisputeMessage {
  from: 'USER' | 'MERCHANT' | 'SUPPORT';
  body: string;
  at: string;
}

export interface Dispute {
  id: string;
  userId: string;
  transactionId: string;
  category: DisputeCategory;
  amount: number;
  description: string;
  status: DisputeStatus;
  messages: DisputeMessage[];
  evidenceUrls: string[];
  openedAt: string;
  resolvedAt?: string;
  resolutionNotes?: string;
  escalatedAt?: string;
}

export class UserDisputeResolutionService {
  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  async list(userId: string): Promise<Dispute[]> {
    const raw = await getRedis().get(this.key(userId));
    return raw ? JSON.parse(raw) : [];
  }

  async open(input: {
    userId: string;
    transactionId: string;
    category: DisputeCategory;
    amount: number;
    description: string;
    evidenceUrls?: string[];
  }): Promise<Dispute> {
    if (input.amount <= 0) throw new Error('Monto debe ser positivo');
    if (input.description.length < 10 || input.description.length > 1000) {
      throw new Error('Descripcion debe tener entre 10 y 1000 caracteres');
    }
    if (input.evidenceUrls) {
      if (input.evidenceUrls.length > 10) throw new Error('Maximo 10 evidencias');
      for (const url of input.evidenceUrls) {
        if (!/^https:\/\//.test(url)) throw new Error('URLs deben ser HTTPS');
      }
    }
    const list = await this.list(input.userId);
    if (list.some(d => d.transactionId === input.transactionId && d.status !== 'CLOSED_NO_ACTION')) {
      throw new Error('Ya existe disputa activa para esta transaccion');
    }
    const activeCount = list.filter(d => ['OPEN', 'IN_REVIEW', 'ESCALATED'].includes(d.status)).length;
    if (activeCount >= 20) throw new Error('Maximo 20 disputas activas');
    const dispute: Dispute = {
      id: `disp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: input.userId,
      transactionId: input.transactionId,
      category: input.category,
      amount: input.amount,
      description: input.description,
      status: 'OPEN',
      messages: [{ from: 'USER', body: input.description, at: new Date().toISOString() }],
      evidenceUrls: input.evidenceUrls ?? [],
      openedAt: new Date().toISOString(),
    };
    list.push(dispute);
    await getRedis().set(this.key(input.userId), JSON.stringify(list), { EX: TTL });
    log.info('dispute opened', { id: dispute.id, category: dispute.category });
    return dispute;
  }

  async startReview(userId: string, id: string): Promise<Dispute | null> {
    const list = await this.list(userId);
    const dispute = list.find(d => d.id === id);
    if (!dispute) return null;
    if (dispute.status !== 'OPEN') throw new Error('Solo disputas abiertas pueden pasar a revision');
    dispute.status = 'IN_REVIEW';
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return dispute;
  }

  async addMessage(userId: string, id: string, from: 'USER' | 'MERCHANT' | 'SUPPORT', body: string): Promise<Dispute | null> {
    if (body.length < 1 || body.length > 2000) throw new Error('Mensaje debe tener entre 1 y 2000 caracteres');
    const list = await this.list(userId);
    const dispute = list.find(d => d.id === id);
    if (!dispute) return null;
    if (dispute.status === 'RESOLVED_USER' || dispute.status === 'RESOLVED_MERCHANT' || dispute.status === 'CLOSED_NO_ACTION') {
      throw new Error('Disputa cerrada, no acepta mensajes');
    }
    dispute.messages.push({ from, body, at: new Date().toISOString() });
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return dispute;
  }

  async resolve(userId: string, id: string, resolution: 'USER' | 'MERCHANT' | 'NO_ACTION', notes: string): Promise<Dispute | null> {
    const list = await this.list(userId);
    const dispute = list.find(d => d.id === id);
    if (!dispute) return null;
    if (['RESOLVED_USER', 'RESOLVED_MERCHANT', 'CLOSED_NO_ACTION'].includes(dispute.status)) {
      throw new Error('Disputa ya cerrada');
    }
    dispute.status = resolution === 'USER' ? 'RESOLVED_USER' : resolution === 'MERCHANT' ? 'RESOLVED_MERCHANT' : 'CLOSED_NO_ACTION';
    dispute.resolvedAt = new Date().toISOString();
    dispute.resolutionNotes = notes;
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    log.info('dispute resolved', { id, resolution });
    return dispute;
  }

  async escalate(userId: string, id: string): Promise<Dispute | null> {
    const list = await this.list(userId);
    const dispute = list.find(d => d.id === id);
    if (!dispute) return null;
    if (dispute.status !== 'IN_REVIEW' && dispute.status !== 'OPEN') {
      throw new Error('Solo disputas abiertas o en revision pueden escalarse');
    }
    dispute.status = 'ESCALATED';
    dispute.escalatedAt = new Date().toISOString();
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    log.warn('dispute escalated', { id });
    return dispute;
  }

  async getActive(userId: string): Promise<Dispute[]> {
    const list = await this.list(userId);
    return list.filter(d => ['OPEN', 'IN_REVIEW', 'ESCALATED'].includes(d.status));
  }

  async getByCategory(userId: string, category: DisputeCategory): Promise<Dispute[]> {
    const list = await this.list(userId);
    return list.filter(d => d.category === category);
  }

  async getStats(userId: string): Promise<{
    total: number;
    open: number;
    resolvedInFavor: number;
    resolvedAgainst: number;
    successRate: number;
    totalAmount: number;
  }> {
    const list = await this.list(userId);
    const resolvedUser = list.filter(d => d.status === 'RESOLVED_USER').length;
    const resolvedMerchant = list.filter(d => d.status === 'RESOLVED_MERCHANT').length;
    const resolved = resolvedUser + resolvedMerchant;
    return {
      total: list.length,
      open: list.filter(d => ['OPEN', 'IN_REVIEW', 'ESCALATED'].includes(d.status)).length,
      resolvedInFavor: resolvedUser,
      resolvedAgainst: resolvedMerchant,
      successRate: resolved > 0 ? Math.round((resolvedUser / resolved) * 100) : 0,
      totalAmount: list.filter(d => d.status === 'RESOLVED_USER').reduce((s, d) => s + d.amount, 0),
    };
  }
}

export const userDisputeResolution = new UserDisputeResolutionService();
