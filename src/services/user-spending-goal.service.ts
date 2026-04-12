import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('spending-goal');
const SPG_PREFIX = 'spgoal:';
const SPG_TTL = 180 * 24 * 60 * 60;

export interface SpendingGoal {
  id: string;
  userId: string;
  category: string;
  maxAmount: number;
  currentSpent: number;
  period: 'WEEK' | 'MONTH';
  startDate: string;
  endDate: string;
  active: boolean;
  createdAt: string;
}

export class UserSpendingGoalService {
  async createGoal(input: { userId: string; category: string; maxAmount: number; period: 'WEEK' | 'MONTH' }): Promise<SpendingGoal> {
    if (input.maxAmount < 1000) throw new Error('Meta minima: $1.000.');
    const now = new Date();
    const end = new Date(now);
    if (input.period === 'WEEK') end.setDate(end.getDate() + 7);
    else end.setMonth(end.getMonth() + 1);

    const goal: SpendingGoal = {
      id: 'spg_' + Date.now().toString(36),
      userId: input.userId,
      category: input.category,
      maxAmount: input.maxAmount,
      currentSpent: 0,
      period: input.period,
      startDate: now.toISOString(),
      endDate: end.toISOString(),
      active: true,
      createdAt: now.toISOString(),
    };
    try { const redis = getRedis(); await redis.set(SPG_PREFIX + goal.id, JSON.stringify(goal), { EX: SPG_TTL }); }
    catch (err) { log.warn('Failed to save goal', { error: (err as Error).message }); }
    return goal;
  }

  async addSpending(goalId: string, amount: number): Promise<{ overLimit: boolean; percentUsed: number }> {
    const goal = await this.getGoal(goalId);
    if (!goal || !goal.active) return { overLimit: false, percentUsed: 0 };
    goal.currentSpent += amount;
    const percent = Math.round((goal.currentSpent / goal.maxAmount) * 100);
    const overLimit = goal.currentSpent > goal.maxAmount;
    try { const redis = getRedis(); await redis.set(SPG_PREFIX + goalId, JSON.stringify(goal), { EX: SPG_TTL }); }
    catch { /* ignore */ }
    return { overLimit, percentUsed: percent };
  }

  async getGoal(id: string): Promise<SpendingGoal | null> {
    try { const redis = getRedis(); const raw = await redis.get(SPG_PREFIX + id); return raw ? JSON.parse(raw) as SpendingGoal : null; }
    catch { return null; }
  }

  async deactivate(id: string): Promise<boolean> {
    const goal = await this.getGoal(id);
    if (!goal) return false;
    goal.active = false;
    try { const redis = getRedis(); await redis.set(SPG_PREFIX + id, JSON.stringify(goal), { EX: SPG_TTL }); }
    catch { return false; }
    return true;
  }

  formatGoalSummary(g: SpendingGoal): string {
    const pct = Math.round((g.currentSpent / g.maxAmount) * 100);
    return g.category + ': ' + formatCLP(g.currentSpent) + ' / ' + formatCLP(g.maxAmount) + ' (' + pct + '%) — ' + g.period;
  }
}

export const userSpendingGoal = new UserSpendingGoalService();
