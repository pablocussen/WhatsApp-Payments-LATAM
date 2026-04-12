import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('recurring-income');
const RI_PREFIX = 'rincome:';
const RI_TTL = 365 * 24 * 60 * 60;

export type IncomeFrequency = 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY';
export type IncomeSource = 'SALARY' | 'FREELANCE' | 'BUSINESS' | 'RENT' | 'INVESTMENT' | 'OTHER';

export interface RecurringIncome {
  id: string;
  userId: string;
  source: IncomeSource;
  description: string;
  amount: number;
  frequency: IncomeFrequency;
  nextExpected: string;
  totalReceived: number;
  active: boolean;
  createdAt: string;
}

export class UserRecurringIncomeService {
  async createIncome(input: { userId: string; source: IncomeSource; description: string; amount: number; frequency: IncomeFrequency; startDate?: string }): Promise<RecurringIncome> {
    if (input.amount < 1000) throw new Error('Monto minimo: $1.000.');
    if (!input.description) throw new Error('Descripcion requerida.');

    const income: RecurringIncome = {
      id: 'rinc_' + Date.now().toString(36),
      userId: input.userId,
      source: input.source,
      description: input.description,
      amount: input.amount,
      frequency: input.frequency,
      nextExpected: this.calcNext(input.frequency, input.startDate),
      totalReceived: 0,
      active: true,
      createdAt: new Date().toISOString(),
    };

    const incomes = await this.getIncomes(input.userId);
    incomes.push(income);
    await this.save(input.userId, incomes);
    return income;
  }

  async getIncomes(userId: string): Promise<RecurringIncome[]> {
    try { const redis = getRedis(); const raw = await redis.get(RI_PREFIX + userId); return raw ? JSON.parse(raw) as RecurringIncome[] : []; }
    catch { return []; }
  }

  async recordReceived(userId: string, incomeId: string): Promise<boolean> {
    const incomes = await this.getIncomes(userId);
    const income = incomes.find(i => i.id === incomeId);
    if (!income || !income.active) return false;
    income.totalReceived += income.amount;
    income.nextExpected = this.calcNext(income.frequency);
    await this.save(userId, incomes);
    return true;
  }

  async getMonthlyTotal(userId: string): Promise<number> {
    const incomes = await this.getIncomes(userId);
    return incomes.filter(i => i.active).reduce((sum, i) => {
      const multiplier = i.frequency === 'WEEKLY' ? 4 : i.frequency === 'BIWEEKLY' ? 2 : 1;
      return sum + (i.amount * multiplier);
    }, 0);
  }

  async deactivate(userId: string, incomeId: string): Promise<boolean> {
    const incomes = await this.getIncomes(userId);
    const income = incomes.find(i => i.id === incomeId);
    if (!income) return false;
    income.active = false;
    await this.save(userId, incomes);
    return true;
  }

  formatIncomeSummary(i: RecurringIncome): string {
    return i.description + ': ' + formatCLP(i.amount) + ' ' + i.frequency + ' — ' + i.source;
  }

  private calcNext(freq: IncomeFrequency, from?: string): string {
    const base = from ? new Date(from) : new Date();
    switch (freq) {
      case 'WEEKLY': base.setDate(base.getDate() + 7); break;
      case 'BIWEEKLY': base.setDate(base.getDate() + 14); break;
      case 'MONTHLY': base.setMonth(base.getMonth() + 1); break;
    }
    return base.toISOString();
  }

  private async save(userId: string, incomes: RecurringIncome[]): Promise<void> {
    try { const redis = getRedis(); await redis.set(RI_PREFIX + userId, JSON.stringify(incomes), { EX: RI_TTL }); }
    catch (err) { log.warn('Failed to save incomes', { error: (err as Error).message }); }
  }
}

export const userRecurringIncome = new UserRecurringIncomeService();
