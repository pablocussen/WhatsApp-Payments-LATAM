import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-savings-jar');
const PREFIX = 'user:savings-jar:';
const TTL = 365 * 24 * 60 * 60;

export type JarStatus = 'OPEN' | 'LOCKED' | 'COMPLETED' | 'BROKEN';

export interface SavingsJar {
  id: string;
  userId: string;
  name: string;
  emoji: string;
  targetAmount: number;
  currentAmount: number;
  status: JarStatus;
  lockUntil?: string;
  breakPenaltyPercent: number;
  deposits: { amount: number; at: string }[];
  createdAt: string;
  completedAt?: string;
}

export class UserSavingsJarService {
  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  async list(userId: string): Promise<SavingsJar[]> {
    const raw = await getRedis().get(this.key(userId));
    return raw ? JSON.parse(raw) : [];
  }

  async create(input: {
    userId: string;
    name: string;
    emoji: string;
    targetAmount: number;
    lockUntil?: string;
    breakPenaltyPercent?: number;
  }): Promise<SavingsJar> {
    if (input.targetAmount < 5000 || input.targetAmount > 50000000) {
      throw new Error('Meta entre $5.000 y $50.000.000');
    }
    if (input.name.length > 40) throw new Error('Nombre excede 40 caracteres');
    if (input.lockUntil && isNaN(new Date(input.lockUntil).getTime())) {
      throw new Error('Fecha lock invalida');
    }
    const penalty = input.breakPenaltyPercent ?? 5;
    if (penalty < 0 || penalty > 50) throw new Error('Penalidad entre 0 y 50 por ciento');
    const list = await this.list(input.userId);
    const open = list.filter(j => j.status === 'OPEN' || j.status === 'LOCKED');
    if (open.length >= 10) throw new Error('Maximo 10 alcancias activas');
    const jar: SavingsJar = {
      id: `jar_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: input.userId,
      name: input.name,
      emoji: input.emoji,
      targetAmount: input.targetAmount,
      currentAmount: 0,
      status: input.lockUntil ? 'LOCKED' : 'OPEN',
      lockUntil: input.lockUntil,
      breakPenaltyPercent: penalty,
      deposits: [],
      createdAt: new Date().toISOString(),
    };
    list.push(jar);
    await getRedis().set(this.key(input.userId), JSON.stringify(list), { EX: TTL });
    log.info('jar created', { id: jar.id });
    return jar;
  }

  async deposit(userId: string, id: string, amount: number): Promise<SavingsJar | null> {
    if (amount <= 0) throw new Error('Deposito debe ser positivo');
    const list = await this.list(userId);
    const jar = list.find(j => j.id === id);
    if (!jar) return null;
    if (jar.status === 'COMPLETED' || jar.status === 'BROKEN') {
      throw new Error('Alcancia no acepta depositos');
    }
    jar.currentAmount += amount;
    jar.deposits.push({ amount, at: new Date().toISOString() });
    if (jar.currentAmount >= jar.targetAmount) {
      jar.status = 'COMPLETED';
      jar.completedAt = new Date().toISOString();
    }
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return jar;
  }

  async breakJar(userId: string, id: string): Promise<{ jar: SavingsJar; refunded: number; penalty: number } | null> {
    const list = await this.list(userId);
    const jar = list.find(j => j.id === id);
    if (!jar) return null;
    if (jar.status === 'COMPLETED' || jar.status === 'BROKEN') {
      throw new Error('Alcancia ya finalizada');
    }
    if (jar.status === 'LOCKED' && jar.lockUntil && new Date(jar.lockUntil).getTime() > Date.now()) {
      const penaltyAmount = Math.round(jar.currentAmount * (jar.breakPenaltyPercent / 100));
      const refunded = jar.currentAmount - penaltyAmount;
      jar.status = 'BROKEN';
      jar.completedAt = new Date().toISOString();
      await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
      return { jar, refunded, penalty: penaltyAmount };
    }
    jar.status = 'BROKEN';
    jar.completedAt = new Date().toISOString();
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return { jar, refunded: jar.currentAmount, penalty: 0 };
  }

  async withdraw(userId: string, id: string): Promise<{ amount: number } | null> {
    const list = await this.list(userId);
    const jar = list.find(j => j.id === id);
    if (!jar) return null;
    if (jar.status !== 'COMPLETED') throw new Error('Solo se puede retirar de alcancias completas');
    const amount = jar.currentAmount;
    jar.currentAmount = 0;
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return { amount };
  }

  async getProgress(userId: string, id: string): Promise<number | null> {
    const list = await this.list(userId);
    const jar = list.find(j => j.id === id);
    if (!jar) return null;
    if (jar.targetAmount === 0) return 0;
    return Math.min(100, Math.round((jar.currentAmount / jar.targetAmount) * 100));
  }

  async getTotalSaved(userId: string): Promise<number> {
    const list = await this.list(userId);
    return list
      .filter(j => j.status !== 'BROKEN')
      .reduce((s, j) => s + j.currentAmount, 0);
  }
}

export const userSavingsJar = new UserSavingsJarService();
