import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-payment-pot');
const PREFIX = 'user:payment-pot:';
const TTL = 365 * 24 * 60 * 60;

export type PotStatus = 'OPEN' | 'CLOSED' | 'CANCELLED';

export interface PotContribution {
  contributorId: string;
  name: string;
  amount: number;
  contributedAt: string;
}

export interface PaymentPot {
  id: string;
  ownerId: string;
  title: string;
  description: string;
  targetAmount: number;
  currentAmount: number;
  status: PotStatus;
  contributions: PotContribution[];
  deadline?: string;
  createdAt: string;
  closedAt?: string;
}

export class UserPaymentPotService {
  private key(ownerId: string): string {
    return `${PREFIX}${ownerId}`;
  }

  async list(ownerId: string): Promise<PaymentPot[]> {
    const raw = await getRedis().get(this.key(ownerId));
    return raw ? JSON.parse(raw) : [];
  }

  async create(input: {
    ownerId: string;
    title: string;
    description: string;
    targetAmount: number;
    deadline?: string;
  }): Promise<PaymentPot> {
    if (input.targetAmount <= 0) throw new Error('Meta debe ser positiva');
    if (input.title.length > 80) throw new Error('Titulo excede 80 caracteres');
    if (input.description.length > 300) throw new Error('Descripcion excede 300 caracteres');
    if (input.deadline && isNaN(new Date(input.deadline).getTime())) {
      throw new Error('Fecha limite invalida');
    }
    const list = await this.list(input.ownerId);
    const openCount = list.filter(p => p.status === 'OPEN').length;
    if (openCount >= 10) throw new Error('Maximo 10 colectas abiertas');
    const pot: PaymentPot = {
      id: `pot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ownerId: input.ownerId,
      title: input.title,
      description: input.description,
      targetAmount: input.targetAmount,
      currentAmount: 0,
      status: 'OPEN',
      contributions: [],
      deadline: input.deadline,
      createdAt: new Date().toISOString(),
    };
    list.push(pot);
    await getRedis().set(this.key(input.ownerId), JSON.stringify(list), { EX: TTL });
    log.info('pot created', { id: pot.id });
    return pot;
  }

  async contribute(ownerId: string, potId: string, contribution: {
    contributorId: string;
    name: string;
    amount: number;
  }): Promise<PaymentPot | null> {
    if (contribution.amount <= 0) throw new Error('Aporte debe ser positivo');
    const list = await this.list(ownerId);
    const pot = list.find(p => p.id === potId);
    if (!pot) return null;
    if (pot.status !== 'OPEN') throw new Error('Colecta no esta abierta');
    if (pot.deadline && new Date(pot.deadline).getTime() < Date.now()) {
      throw new Error('Colecta expirada');
    }
    pot.contributions.push({
      contributorId: contribution.contributorId,
      name: contribution.name,
      amount: contribution.amount,
      contributedAt: new Date().toISOString(),
    });
    pot.currentAmount += contribution.amount;
    if (pot.currentAmount >= pot.targetAmount) {
      pot.status = 'CLOSED';
      pot.closedAt = new Date().toISOString();
    }
    await getRedis().set(this.key(ownerId), JSON.stringify(list), { EX: TTL });
    return pot;
  }

  async close(ownerId: string, potId: string): Promise<PaymentPot | null> {
    const list = await this.list(ownerId);
    const pot = list.find(p => p.id === potId);
    if (!pot || pot.status !== 'OPEN') return null;
    pot.status = 'CLOSED';
    pot.closedAt = new Date().toISOString();
    await getRedis().set(this.key(ownerId), JSON.stringify(list), { EX: TTL });
    return pot;
  }

  async cancel(ownerId: string, potId: string): Promise<PaymentPot | null> {
    const list = await this.list(ownerId);
    const pot = list.find(p => p.id === potId);
    if (!pot || pot.status !== 'OPEN') return null;
    pot.status = 'CANCELLED';
    pot.closedAt = new Date().toISOString();
    await getRedis().set(this.key(ownerId), JSON.stringify(list), { EX: TTL });
    return pot;
  }

  async getContributorCount(ownerId: string, potId: string): Promise<number> {
    const list = await this.list(ownerId);
    const pot = list.find(p => p.id === potId);
    if (!pot) return 0;
    return new Set(pot.contributions.map(c => c.contributorId)).size;
  }

  computeProgress(pot: PaymentPot): number {
    if (pot.targetAmount === 0) return 0;
    return Math.min(100, Math.round((pot.currentAmount / pot.targetAmount) * 100));
  }
}

export const userPaymentPot = new UserPaymentPotService();
