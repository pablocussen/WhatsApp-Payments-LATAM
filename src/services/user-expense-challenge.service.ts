import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-expense-challenge');
const PREFIX = 'user:expense-challenge:';
const TTL = 365 * 24 * 60 * 60;

export type ChallengeType = 'NO_SPEND_DAY' | 'WEEKLY_LIMIT' | 'CATEGORY_FREE' | 'SAVE_AMOUNT';
export type ChallengeStatus = 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'ABANDONED';

export interface ExpenseChallenge {
  id: string;
  userId: string;
  type: ChallengeType;
  name: string;
  description: string;
  targetAmount?: number;
  targetCategory?: string;
  durationDays: number;
  startDate: string;
  endDate: string;
  status: ChallengeStatus;
  currentProgress: number;
  rewardPoints: number;
  createdAt: string;
}

export class UserExpenseChallengeService {
  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  async list(userId: string): Promise<ExpenseChallenge[]> {
    const raw = await getRedis().get(this.key(userId));
    return raw ? JSON.parse(raw) : [];
  }

  async create(input: {
    userId: string;
    type: ChallengeType;
    name: string;
    description: string;
    targetAmount?: number;
    targetCategory?: string;
    durationDays: number;
  }): Promise<ExpenseChallenge> {
    if (input.durationDays < 1 || input.durationDays > 90) {
      throw new Error('La duracion debe ser entre 1 y 90 dias');
    }
    if (input.name.length > 50) {
      throw new Error('Nombre no puede superar 50 caracteres');
    }
    const list = await this.list(input.userId);
    const active = list.filter(c => c.status === 'ACTIVE');
    if (active.length >= 5) {
      throw new Error('Maximo 5 desafios activos simultaneos');
    }
    const now = new Date();
    const end = new Date(now.getTime() + input.durationDays * 24 * 60 * 60 * 1000);
    const rewardPoints = Math.min(500, input.durationDays * 10);
    const challenge: ExpenseChallenge = {
      id: `ch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: input.userId,
      type: input.type,
      name: input.name,
      description: input.description,
      targetAmount: input.targetAmount,
      targetCategory: input.targetCategory,
      durationDays: input.durationDays,
      startDate: now.toISOString(),
      endDate: end.toISOString(),
      status: 'ACTIVE',
      currentProgress: 0,
      rewardPoints,
      createdAt: now.toISOString(),
    };
    list.push(challenge);
    await getRedis().set(this.key(input.userId), JSON.stringify(list), { EX: TTL });
    log.info('challenge created', { id: challenge.id, type: challenge.type });
    return challenge;
  }

  async updateProgress(userId: string, id: string, progress: number): Promise<ExpenseChallenge | null> {
    const list = await this.list(userId);
    const ch = list.find(c => c.id === id);
    if (!ch || ch.status !== 'ACTIVE') return null;
    ch.currentProgress = progress;
    if (ch.targetAmount && progress >= ch.targetAmount) {
      ch.status = 'COMPLETED';
    }
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return ch;
  }

  async abandon(userId: string, id: string): Promise<boolean> {
    const list = await this.list(userId);
    const ch = list.find(c => c.id === id);
    if (!ch || ch.status !== 'ACTIVE') return false;
    ch.status = 'ABANDONED';
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return true;
  }

  async checkExpired(userId: string): Promise<number> {
    const list = await this.list(userId);
    const now = Date.now();
    let expired = 0;
    for (const ch of list) {
      if (ch.status === 'ACTIVE' && new Date(ch.endDate).getTime() < now) {
        if (ch.targetAmount && ch.currentProgress >= ch.targetAmount) {
          ch.status = 'COMPLETED';
        } else {
          ch.status = 'FAILED';
        }
        expired++;
      }
    }
    if (expired > 0) {
      await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    }
    return expired;
  }

  async getStats(userId: string): Promise<{ total: number; completed: number; failed: number; active: number; totalPoints: number }> {
    const list = await this.list(userId);
    const completed = list.filter(c => c.status === 'COMPLETED');
    return {
      total: list.length,
      completed: completed.length,
      failed: list.filter(c => c.status === 'FAILED').length,
      active: list.filter(c => c.status === 'ACTIVE').length,
      totalPoints: completed.reduce((s, c) => s + c.rewardPoints, 0),
    };
  }
}

export const userExpenseChallenge = new UserExpenseChallengeService();
