import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('budget-alert');

const BUDGET_PREFIX = 'budget:';
const BUDGET_TTL = 365 * 24 * 60 * 60;

export type BudgetPeriod = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface BudgetAlert {
  id: string;
  userId: string;
  name: string;
  period: BudgetPeriod;
  limitAmount: number;
  spentAmount: number;
  alertAt: number; // percentage (e.g. 80 = alert at 80% spent)
  alerted: boolean;
  enabled: boolean;
  createdAt: string;
}

const MAX_BUDGETS = 10;

export class BudgetAlertService {
  /**
   * Create a budget alert.
   */
  async createBudget(input: {
    userId: string;
    name: string;
    period: BudgetPeriod;
    limitAmount: number;
    alertAt?: number;
  }): Promise<BudgetAlert> {
    if (!input.name || input.name.length > 50) {
      throw new Error('Nombre debe tener entre 1 y 50 caracteres.');
    }
    if (input.limitAmount < 1000) {
      throw new Error('Limite minimo: $1.000.');
    }

    const existing = await this.getBudgets(input.userId);
    if (existing.length >= MAX_BUDGETS) {
      throw new Error(`Maximo ${MAX_BUDGETS} presupuestos.`);
    }

    const budget: BudgetAlert = {
      id: `bgt_${Date.now().toString(36)}`,
      userId: input.userId,
      name: input.name,
      period: input.period,
      limitAmount: input.limitAmount,
      spentAmount: 0,
      alertAt: input.alertAt ?? 80,
      alerted: false,
      enabled: true,
      createdAt: new Date().toISOString(),
    };

    const budgets = [...existing, budget];
    await this.saveBudgets(input.userId, budgets);

    log.info('Budget created', { userId: input.userId, budgetId: budget.id, limit: input.limitAmount });
    return budget;
  }

  /**
   * Get all budgets for a user.
   */
  async getBudgets(userId: string): Promise<BudgetAlert[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${BUDGET_PREFIX}${userId}`);
      return raw ? JSON.parse(raw) as BudgetAlert[] : [];
    } catch {
      return [];
    }
  }

  /**
   * Record spending against matching budgets. Returns alerts triggered.
   */
  async recordSpending(userId: string, amount: number): Promise<BudgetAlert[]> {
    const budgets = await this.getBudgets(userId);
    const triggered: BudgetAlert[] = [];

    for (const b of budgets) {
      if (!b.enabled) continue;
      b.spentAmount += amount;
      const pct = (b.spentAmount / b.limitAmount) * 100;

      if (pct >= b.alertAt && !b.alerted) {
        b.alerted = true;
        triggered.push(b);
      }
    }

    if (budgets.length > 0) {
      await this.saveBudgets(userId, budgets);
    }

    return triggered;
  }

  /**
   * Reset spending for a budget (e.g. at start of new period).
   */
  async resetBudget(userId: string, budgetId: string): Promise<boolean> {
    const budgets = await this.getBudgets(userId);
    const budget = budgets.find(b => b.id === budgetId);
    if (!budget) return false;

    budget.spentAmount = 0;
    budget.alerted = false;
    await this.saveBudgets(userId, budgets);
    return true;
  }

  /**
   * Delete a budget.
   */
  async deleteBudget(userId: string, budgetId: string): Promise<boolean> {
    const budgets = await this.getBudgets(userId);
    const filtered = budgets.filter(b => b.id !== budgetId);
    if (filtered.length === budgets.length) return false;
    await this.saveBudgets(userId, filtered);
    return true;
  }

  /**
   * Get budget status summary.
   */
  getBudgetSummary(budget: BudgetAlert): string {
    const pct = Math.round((budget.spentAmount / budget.limitAmount) * 100);
    const remaining = budget.limitAmount - budget.spentAmount;
    return `${budget.name}: ${formatCLP(budget.spentAmount)} / ${formatCLP(budget.limitAmount)} (${pct}%) — Quedan ${formatCLP(Math.max(0, remaining))}`;
  }

  private async saveBudgets(userId: string, budgets: BudgetAlert[]): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${BUDGET_PREFIX}${userId}`, JSON.stringify(budgets), { EX: BUDGET_TTL });
    } catch (err) {
      log.warn('Failed to save budgets', { userId, error: (err as Error).message });
    }
  }
}

export const budgetAlerts = new BudgetAlertService();
