import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('savings-goal');
const GOAL_PREFIX = 'sgoal:';
const GOAL_TTL = 365 * 24 * 60 * 60;
const MAX_GOALS = 5;

export type GoalStatus = 'ACTIVE' | 'COMPLETED' | 'ABANDONED';

export interface SavingsGoal {
  id: string;
  userId: string;
  name: string;
  targetAmount: number;
  currentAmount: number;
  deadline: string | null;
  status: GoalStatus;
  contributions: number;
  createdAt: string;
  completedAt: string | null;
}

export class SavingsGoalService {
  async createGoal(input: { userId: string; name: string; targetAmount: number; deadline?: string }): Promise<SavingsGoal> {
    if (!input.name || input.name.length > 50) throw new Error('Nombre entre 1 y 50 caracteres.');
    if (input.targetAmount < 1000) throw new Error('Meta mínima: $1.000.');
    const goals = await this.getGoals(input.userId);
    if (goals.filter(g => g.status === 'ACTIVE').length >= MAX_GOALS) throw new Error(`Máximo ${MAX_GOALS} metas activas.`);
    const goal: SavingsGoal = {
      id: `goal_${Date.now().toString(36)}`, userId: input.userId, name: input.name,
      targetAmount: input.targetAmount, currentAmount: 0, deadline: input.deadline ?? null,
      status: 'ACTIVE', contributions: 0, createdAt: new Date().toISOString(), completedAt: null,
    };
    goals.push(goal);
    await this.save(input.userId, goals);
    log.info('Goal created', { userId: input.userId, goalId: goal.id });
    return goal;
  }

  async contribute(userId: string, goalId: string, amount: number): Promise<SavingsGoal | null> {
    if (amount <= 0) throw new Error('Monto debe ser positivo.');
    const goals = await this.getGoals(userId);
    const goal = goals.find(g => g.id === goalId && g.status === 'ACTIVE');
    if (!goal) return null;
    goal.currentAmount += amount;
    goal.contributions++;
    if (goal.currentAmount >= goal.targetAmount) {
      goal.status = 'COMPLETED';
      goal.completedAt = new Date().toISOString();
    }
    await this.save(userId, goals);
    return goal;
  }

  async withdraw(userId: string, goalId: string, amount: number): Promise<SavingsGoal | null> {
    if (amount <= 0) throw new Error('Monto debe ser positivo.');
    const goals = await this.getGoals(userId);
    const goal = goals.find(g => g.id === goalId && g.status === 'ACTIVE');
    if (!goal) return null;
    if (amount > goal.currentAmount) throw new Error('Fondos insuficientes.');
    goal.currentAmount -= amount;
    await this.save(userId, goals);
    return goal;
  }

  async abandonGoal(userId: string, goalId: string): Promise<boolean> {
    const goals = await this.getGoals(userId);
    const goal = goals.find(g => g.id === goalId);
    if (!goal || goal.status !== 'ACTIVE') return false;
    goal.status = 'ABANDONED';
    await this.save(userId, goals);
    return true;
  }

  async getGoals(userId: string): Promise<SavingsGoal[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${GOAL_PREFIX}${userId}`);
      return raw ? JSON.parse(raw) as SavingsGoal[] : [];
    } catch { return []; }
  }

  getProgress(goal: SavingsGoal): number {
    return Math.min(100, Math.round((goal.currentAmount / goal.targetAmount) * 100));
  }

  formatGoalSummary(goal: SavingsGoal): string {
    const pct = this.getProgress(goal);
    const bar = '█'.repeat(Math.floor(pct / 10)) + '░'.repeat(10 - Math.floor(pct / 10));
    return `${goal.name}: ${formatCLP(goal.currentAmount)} / ${formatCLP(goal.targetAmount)} [${bar}] ${pct}%`;
  }

  private async save(userId: string, goals: SavingsGoal[]): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${GOAL_PREFIX}${userId}`, JSON.stringify(goals), { EX: GOAL_TTL });
    } catch (err) {
      log.warn('Failed to save goals', { userId, error: (err as Error).message });
    }
  }
}

export const savingsGoals = new SavingsGoalService();
