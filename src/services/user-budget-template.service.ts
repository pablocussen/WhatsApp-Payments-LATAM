import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('budget-template');
const BT_PREFIX = 'budgettpl:';
const BT_TTL = 365 * 24 * 60 * 60;

export interface BudgetCategory {
  category: string;
  amount: number;
  percentage: number;
}

export interface BudgetTemplate {
  id: string;
  userId: string;
  name: string;
  monthlyIncome: number;
  categories: BudgetCategory[];
  savingsGoal: number;
  active: boolean;
  createdAt: string;
}

const PRESET_50_30_20: BudgetCategory[] = [
  { category: 'NECESIDADES', amount: 0, percentage: 50 },
  { category: 'DESEOS', amount: 0, percentage: 30 },
  { category: 'AHORRO', amount: 0, percentage: 20 },
];

export class UserBudgetTemplateService {
  async createTemplate(input: { userId: string; name: string; monthlyIncome: number; categories?: BudgetCategory[] }): Promise<BudgetTemplate> {
    if (!input.name) throw new Error('Nombre requerido.');
    if (input.monthlyIncome < 100000) throw new Error('Ingreso mínimo: $100.000.');

    let cats = input.categories;
    if (!cats || cats.length === 0) {
      cats = PRESET_50_30_20.map(c => ({ ...c, amount: Math.round(input.monthlyIncome * c.percentage / 100) }));
    } else {
      const sumPct = cats.reduce((s, c) => s + c.percentage, 0);
      if (Math.abs(sumPct - 100) > 1) throw new Error('Porcentajes deben sumar 100%.');
      cats = cats.map(c => ({ ...c, amount: Math.round(input.monthlyIncome * c.percentage / 100) }));
    }

    const tpl: BudgetTemplate = {
      id: 'btpl_' + Date.now().toString(36),
      userId: input.userId, name: input.name,
      monthlyIncome: input.monthlyIncome,
      categories: cats,
      savingsGoal: cats.find(c => c.category === 'AHORRO')?.amount ?? 0,
      active: true,
      createdAt: new Date().toISOString(),
    };
    try { const redis = getRedis(); await redis.set(BT_PREFIX + tpl.id, JSON.stringify(tpl), { EX: BT_TTL }); }
    catch (err) { log.warn('Failed to save template', { error: (err as Error).message }); }
    return tpl;
  }

  async getTemplate(id: string): Promise<BudgetTemplate | null> {
    try { const redis = getRedis(); const raw = await redis.get(BT_PREFIX + id); return raw ? JSON.parse(raw) as BudgetTemplate : null; }
    catch { return null; }
  }

  formatTemplateSummary(tpl: BudgetTemplate): string {
    const lines = [
      tpl.name + ' — Ingreso: ' + formatCLP(tpl.monthlyIncome),
      ...tpl.categories.map(c => '  ' + c.category + ': ' + formatCLP(c.amount) + ' (' + c.percentage + '%)'),
      'Meta de ahorro: ' + formatCLP(tpl.savingsGoal),
    ];
    return lines.join('\n');
  }
}

export const userBudgetTemplate = new UserBudgetTemplateService();
