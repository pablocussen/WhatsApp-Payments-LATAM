import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('sales-goal');
const SG_PREFIX = 'salesgoal:';
const SG_TTL = 365 * 24 * 60 * 60;

export type GoalPeriod = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'QUARTERLY';
export type GoalStatus = 'ACTIVE' | 'ACHIEVED' | 'MISSED' | 'CANCELLED';

export interface SalesGoal {
  id: string;
  merchantId: string;
  period: GoalPeriod;
  targetAmount: number;
  currentAmount: number;
  startDate: string;
  endDate: string;
  status: GoalStatus;
  bonus: number;
  createdAt: string;
  achievedAt: string | null;
}

export class MerchantSalesGoalService {
  async createGoal(input: { merchantId: string; period: GoalPeriod; targetAmount: number; bonus?: number }): Promise<SalesGoal> {
    if (input.targetAmount < 10000) throw new Error('Meta minima: $10.000.');
    const now = new Date();
    const endDate = new Date();
    switch (input.period) {
      case 'DAILY': endDate.setDate(now.getDate() + 1); break;
      case 'WEEKLY': endDate.setDate(now.getDate() + 7); break;
      case 'MONTHLY': endDate.setMonth(now.getMonth() + 1); break;
      case 'QUARTERLY': endDate.setMonth(now.getMonth() + 3); break;
    }

    const goal: SalesGoal = {
      id: `sgoal_${Date.now().toString(36)}`, merchantId: input.merchantId,
      period: input.period, targetAmount: input.targetAmount,
      currentAmount: 0, startDate: now.toISOString(), endDate: endDate.toISOString(),
      status: 'ACTIVE', bonus: input.bonus ?? 0,
      createdAt: now.toISOString(), achievedAt: null,
    };
    try {
      const redis = getRedis();
      await redis.set(`${SG_PREFIX}${goal.id}`, JSON.stringify(goal), { EX: SG_TTL });
    } catch (err) { log.warn('Failed to save goal', { error: (err as Error).message }); }
    return goal;
  }

  async addSale(goalId: string, amount: number): Promise<SalesGoal | null> {
    const goal = await this.getGoal(goalId);
    if (!goal || goal.status !== 'ACTIVE') return null;
    goal.currentAmount += amount;
    if (goal.currentAmount >= goal.targetAmount) {
      goal.status = 'ACHIEVED';
      goal.achievedAt = new Date().toISOString();
    }
    try {
      const redis = getRedis();
      await redis.set(`${SG_PREFIX}${goalId}`, JSON.stringify(goal), { EX: SG_TTL });
    } catch { return null; }
    return goal;
  }

  async getGoal(goalId: string): Promise<SalesGoal | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${SG_PREFIX}${goalId}`);
      return raw ? JSON.parse(raw) as SalesGoal : null;
    } catch { return null; }
  }

  getProgress(goal: SalesGoal): number {
    return Math.min(100, Math.round((goal.currentAmount / goal.targetAmount) * 100));
  }

  formatGoalSummary(goal: SalesGoal): string {
    const pct = this.getProgress(goal);
    const remaining = Math.max(0, goal.targetAmount - goal.currentAmount);
    return `${goal.period}: ${formatCLP(goal.currentAmount)} / ${formatCLP(goal.targetAmount)} (${pct}%) — Falta ${formatCLP(remaining)}`;
  }
}

export const merchantSalesGoal = new MerchantSalesGoalService();
