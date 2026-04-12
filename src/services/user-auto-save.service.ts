import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('auto-save');
const AS_PREFIX = 'autosave:';
const AS_TTL = 365 * 24 * 60 * 60;

export type SaveTriggerType = 'FIXED_AMOUNT' | 'PERCENT_OF_INCOME' | 'ROUND_UP' | 'SPARE_CHANGE';

export interface AutoSaveRule {
  id: string;
  userId: string;
  name: string;
  type: SaveTriggerType;
  amount: number;
  percent: number;
  targetGoalId: string | null;
  active: boolean;
  totalSaved: number;
  savesCount: number;
  createdAt: string;
}

export class UserAutoSaveService {
  async createRule(input: { userId: string; name: string; type: SaveTriggerType; amount?: number; percent?: number; targetGoalId?: string }): Promise<AutoSaveRule> {
    if (!input.name) throw new Error('Nombre requerido.');
    if (input.type === 'FIXED_AMOUNT' && (!input.amount || input.amount < 100)) throw new Error('Monto minimo: $100.');
    if (input.type === 'PERCENT_OF_INCOME' && (!input.percent || input.percent < 1 || input.percent > 50)) throw new Error('Porcentaje entre 1 y 50.');

    const rules = await this.getRules(input.userId);
    if (rules.length >= 5) throw new Error('Maximo 5 reglas de auto-ahorro.');

    const rule: AutoSaveRule = {
      id: 'asave_' + Date.now().toString(36),
      userId: input.userId,
      name: input.name,
      type: input.type,
      amount: input.amount ?? 0,
      percent: input.percent ?? 0,
      targetGoalId: input.targetGoalId ?? null,
      active: true,
      totalSaved: 0,
      savesCount: 0,
      createdAt: new Date().toISOString(),
    };
    rules.push(rule);
    await this.save(input.userId, rules);
    return rule;
  }

  calculateSaveAmount(rule: AutoSaveRule, transactionAmount: number, incomeAmount?: number): number {
    switch (rule.type) {
      case 'FIXED_AMOUNT':
        return rule.amount;
      case 'PERCENT_OF_INCOME':
        return incomeAmount ? Math.round(incomeAmount * rule.percent / 100) : 0;
      case 'ROUND_UP': {
        const rounded = Math.ceil(transactionAmount / 1000) * 1000;
        return rounded - transactionAmount;
      }
      case 'SPARE_CHANGE':
        return Math.max(0, transactionAmount % 1000);
      default:
        return 0;
    }
  }

  async recordSave(userId: string, ruleId: string, amount: number): Promise<boolean> {
    const rules = await this.getRules(userId);
    const rule = rules.find(r => r.id === ruleId);
    if (!rule || !rule.active) return false;
    rule.totalSaved += amount;
    rule.savesCount++;
    await this.save(userId, rules);
    return true;
  }

  async getRules(userId: string): Promise<AutoSaveRule[]> {
    try { const redis = getRedis(); const raw = await redis.get(AS_PREFIX + userId); return raw ? JSON.parse(raw) as AutoSaveRule[] : []; }
    catch { return []; }
  }

  async deactivate(userId: string, ruleId: string): Promise<boolean> {
    const rules = await this.getRules(userId);
    const rule = rules.find(r => r.id === ruleId);
    if (!rule) return false;
    rule.active = false;
    await this.save(userId, rules);
    return true;
  }

  formatRuleSummary(r: AutoSaveRule): string {
    return r.name + ' (' + r.type + '): ' + formatCLP(r.totalSaved) + ' ahorrado en ' + r.savesCount + ' veces';
  }

  private async save(userId: string, rules: AutoSaveRule[]): Promise<void> {
    try { const redis = getRedis(); await redis.set(AS_PREFIX + userId, JSON.stringify(rules), { EX: AS_TTL }); }
    catch (err) { log.warn('Failed to save rules', { error: (err as Error).message }); }
  }
}

export const userAutoSave = new UserAutoSaveService();
