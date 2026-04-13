import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-subscription-tracker');
const PREFIX = 'user:sub-tracker:';
const TTL = 365 * 24 * 60 * 60;

export type Frequency = 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export type SubStatus = 'ACTIVE' | 'CANCELLED' | 'PAUSED';

export interface TrackedSubscription {
  id: string;
  userId: string;
  name: string;
  amount: number;
  frequency: Frequency;
  nextChargeAt: string;
  status: SubStatus;
  category: string;
  createdAt: string;
}

export class UserSubscriptionTrackerService {
  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  async list(userId: string): Promise<TrackedSubscription[]> {
    const raw = await getRedis().get(this.key(userId));
    return raw ? JSON.parse(raw) : [];
  }

  private computeNextCharge(from: Date, frequency: Frequency): Date {
    const next = new Date(from);
    switch (frequency) {
      case 'WEEKLY': next.setDate(next.getDate() + 7); break;
      case 'MONTHLY': next.setMonth(next.getMonth() + 1); break;
      case 'YEARLY': next.setFullYear(next.getFullYear() + 1); break;
    }
    return next;
  }

  async add(input: {
    userId: string;
    name: string;
    amount: number;
    frequency: Frequency;
    category: string;
    firstChargeAt?: string;
  }): Promise<TrackedSubscription> {
    if (input.amount <= 0) throw new Error('Monto debe ser positivo');
    if (input.name.length > 50) throw new Error('Nombre excede 50 caracteres');
    const list = await this.list(input.userId);
    if (list.length >= 30) throw new Error('Maximo 30 suscripciones rastreadas');
    const nextCharge = input.firstChargeAt ? new Date(input.firstChargeAt) : this.computeNextCharge(new Date(), input.frequency);
    const sub: TrackedSubscription = {
      id: `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: input.userId,
      name: input.name,
      amount: input.amount,
      frequency: input.frequency,
      nextChargeAt: nextCharge.toISOString(),
      status: 'ACTIVE',
      category: input.category,
      createdAt: new Date().toISOString(),
    };
    list.push(sub);
    await getRedis().set(this.key(input.userId), JSON.stringify(list), { EX: TTL });
    log.info('subscription tracked', { id: sub.id });
    return sub;
  }

  async cancel(userId: string, id: string): Promise<boolean> {
    const list = await this.list(userId);
    const sub = list.find(s => s.id === id);
    if (!sub || sub.status === 'CANCELLED') return false;
    sub.status = 'CANCELLED';
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return true;
  }

  async pause(userId: string, id: string): Promise<boolean> {
    const list = await this.list(userId);
    const sub = list.find(s => s.id === id);
    if (!sub || sub.status !== 'ACTIVE') return false;
    sub.status = 'PAUSED';
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return true;
  }

  async getMonthlyTotal(userId: string): Promise<number> {
    const list = await this.list(userId);
    return list
      .filter(s => s.status === 'ACTIVE')
      .reduce((sum, s) => {
        if (s.frequency === 'MONTHLY') return sum + s.amount;
        if (s.frequency === 'WEEKLY') return sum + s.amount * 4.33;
        if (s.frequency === 'YEARLY') return sum + s.amount / 12;
        return sum;
      }, 0);
  }

  async getUpcoming(userId: string, days: number): Promise<TrackedSubscription[]> {
    const list = await this.list(userId);
    const cutoff = Date.now() + days * 24 * 60 * 60 * 1000;
    return list
      .filter(s => s.status === 'ACTIVE' && new Date(s.nextChargeAt).getTime() <= cutoff)
      .sort((a, b) => new Date(a.nextChargeAt).getTime() - new Date(b.nextChargeAt).getTime());
  }

  async getByCategory(userId: string): Promise<Record<string, number>> {
    const list = await this.list(userId);
    const totals: Record<string, number> = {};
    for (const s of list.filter(x => x.status === 'ACTIVE')) {
      totals[s.category] = (totals[s.category] ?? 0) + s.amount;
    }
    return totals;
  }
}

export const userSubscriptionTracker = new UserSubscriptionTrackerService();
