import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('spending-limits-v2');
const SL_PREFIX = 'splimit2:';
const SL_TTL = 365 * 24 * 60 * 60;

export interface SpendingLimit {
  userId: string;
  daily: number;
  weekly: number;
  monthly: number;
  perTransaction: number;
  usedToday: number;
  usedWeek: number;
  usedMonth: number;
  lastResetDay: string;
  lastResetWeek: string;
  lastResetMonth: string;
  updatedAt: string;
}

export class UserSpendingLimitsV2Service {
  async getLimits(userId: string): Promise<SpendingLimit> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${SL_PREFIX}${userId}`);
      if (raw) {
        const limits = JSON.parse(raw) as SpendingLimit;
        return this.maybeReset(limits);
      }
    } catch { /* defaults */ }
    const today = new Date().toISOString().slice(0, 10);
    const weekStart = this.getWeekStart();
    const monthStart = new Date().toISOString().slice(0, 7);
    return {
      userId, daily: 500000, weekly: 2000000, monthly: 5000000, perTransaction: 1000000,
      usedToday: 0, usedWeek: 0, usedMonth: 0,
      lastResetDay: today, lastResetWeek: weekStart, lastResetMonth: monthStart,
      updatedAt: new Date().toISOString(),
    };
  }

  async updateLimits(userId: string, updates: { daily?: number; weekly?: number; monthly?: number; perTransaction?: number }): Promise<SpendingLimit> {
    const limits = await this.getLimits(userId);
    if (updates.daily !== undefined) {
      if (updates.daily < 0) throw new Error('Limite no puede ser negativo.');
      limits.daily = updates.daily;
    }
    if (updates.weekly !== undefined) limits.weekly = updates.weekly;
    if (updates.monthly !== undefined) limits.monthly = updates.monthly;
    if (updates.perTransaction !== undefined) limits.perTransaction = updates.perTransaction;
    limits.updatedAt = new Date().toISOString();
    try {
      const redis = getRedis();
      await redis.set(`${SL_PREFIX}${userId}`, JSON.stringify(limits), { EX: SL_TTL });
    } catch (err) { log.warn('Failed to save limits', { error: (err as Error).message }); }
    return limits;
  }

  async checkSpending(userId: string, amount: number): Promise<{ allowed: boolean; reason?: string; limits: SpendingLimit }> {
    const limits = await this.getLimits(userId);
    if (amount > limits.perTransaction) {
      return { allowed: false, reason: `Excede limite por transaccion (${formatCLP(limits.perTransaction)})`, limits };
    }
    if (limits.usedToday + amount > limits.daily) {
      return { allowed: false, reason: `Excede limite diario (${formatCLP(limits.daily)})`, limits };
    }
    if (limits.usedWeek + amount > limits.weekly) {
      return { allowed: false, reason: `Excede limite semanal (${formatCLP(limits.weekly)})`, limits };
    }
    if (limits.usedMonth + amount > limits.monthly) {
      return { allowed: false, reason: `Excede limite mensual (${formatCLP(limits.monthly)})`, limits };
    }
    return { allowed: true, limits };
  }

  async recordSpending(userId: string, amount: number): Promise<SpendingLimit> {
    const limits = await this.getLimits(userId);
    limits.usedToday += amount;
    limits.usedWeek += amount;
    limits.usedMonth += amount;
    limits.updatedAt = new Date().toISOString();
    try {
      const redis = getRedis();
      await redis.set(`${SL_PREFIX}${userId}`, JSON.stringify(limits), { EX: SL_TTL });
    } catch (err) { log.warn('Failed to record spending', { error: (err as Error).message }); }
    return limits;
  }

  private maybeReset(limits: SpendingLimit): SpendingLimit {
    const today = new Date().toISOString().slice(0, 10);
    const weekStart = this.getWeekStart();
    const monthStart = new Date().toISOString().slice(0, 7);
    if (limits.lastResetDay !== today) { limits.usedToday = 0; limits.lastResetDay = today; }
    if (limits.lastResetWeek !== weekStart) { limits.usedWeek = 0; limits.lastResetWeek = weekStart; }
    if (limits.lastResetMonth !== monthStart) { limits.usedMonth = 0; limits.lastResetMonth = monthStart; }
    return limits;
  }

  private getWeekStart(): string {
    const d = new Date();
    const day = d.getDay();
    d.setDate(d.getDate() - day);
    return d.toISOString().slice(0, 10);
  }
}

export const userSpendingLimitsV2 = new UserSpendingLimitsV2Service();
