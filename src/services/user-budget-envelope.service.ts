import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-budget-envelope');
const PREFIX = 'user:envelope:';
const TTL = 365 * 24 * 60 * 60;

export interface BudgetEnvelope {
  id: string;
  userId: string;
  name: string;
  category: string;
  monthlyLimit: number;
  spent: number;
  color: string;
  icon: string;
  rolloverEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export class UserBudgetEnvelopeService {
  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  async list(userId: string): Promise<BudgetEnvelope[]> {
    const raw = await getRedis().get(this.key(userId));
    return raw ? JSON.parse(raw) : [];
  }

  async create(input: {
    userId: string;
    name: string;
    category: string;
    monthlyLimit: number;
    color?: string;
    icon?: string;
    rolloverEnabled?: boolean;
  }): Promise<BudgetEnvelope> {
    if (input.monthlyLimit <= 0) throw new Error('Limite mensual debe ser positivo');
    if (input.name.length > 40) throw new Error('Nombre excede 40 caracteres');
    const list = await this.list(input.userId);
    if (list.length >= 15) throw new Error('Maximo 15 sobres');
    if (list.some(e => e.name.toLowerCase() === input.name.toLowerCase())) {
      throw new Error('Ya existe un sobre con ese nombre');
    }
    const envelope: BudgetEnvelope = {
      id: `env_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: input.userId,
      name: input.name,
      category: input.category,
      monthlyLimit: input.monthlyLimit,
      spent: 0,
      color: input.color ?? '#06b6d4',
      icon: input.icon ?? '💰',
      rolloverEnabled: input.rolloverEnabled ?? false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    list.push(envelope);
    await getRedis().set(this.key(input.userId), JSON.stringify(list), { EX: TTL });
    log.info('envelope created', { id: envelope.id });
    return envelope;
  }

  async recordSpend(userId: string, id: string, amount: number): Promise<BudgetEnvelope | null> {
    if (amount <= 0) throw new Error('Monto debe ser positivo');
    const list = await this.list(userId);
    const env = list.find(e => e.id === id);
    if (!env) return null;
    env.spent += amount;
    env.updatedAt = new Date().toISOString();
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return env;
  }

  async resetMonthly(userId: string): Promise<number> {
    const list = await this.list(userId);
    let reset = 0;
    for (const env of list) {
      if (env.rolloverEnabled) {
        const remaining = Math.max(0, env.monthlyLimit - env.spent);
        env.monthlyLimit += remaining;
      }
      env.spent = 0;
      env.updatedAt = new Date().toISOString();
      reset++;
    }
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return reset;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const list = await this.list(userId);
    const idx = list.findIndex(e => e.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return true;
  }

  async getOverLimit(userId: string): Promise<BudgetEnvelope[]> {
    const list = await this.list(userId);
    return list.filter(e => e.spent > e.monthlyLimit);
  }

  async getTotalSpent(userId: string): Promise<{ spent: number; limit: number; percentage: number }> {
    const list = await this.list(userId);
    const spent = list.reduce((s, e) => s + e.spent, 0);
    const limit = list.reduce((s, e) => s + e.monthlyLimit, 0);
    return {
      spent,
      limit,
      percentage: limit > 0 ? Math.round((spent / limit) * 100) : 0,
    };
  }

  computeProgress(env: BudgetEnvelope): number {
    if (env.monthlyLimit === 0) return 0;
    return Math.min(100, Math.round((env.spent / env.monthlyLimit) * 100));
  }
}

export const userBudgetEnvelope = new UserBudgetEnvelopeService();
