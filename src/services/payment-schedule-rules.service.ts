import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('payment-schedule-rules');

const RULE_PREFIX = 'payrule:';
const RULE_TTL = 365 * 24 * 60 * 60;
const MAX_RULES = 15;

export type RuleType = 'FIXED_DAY' | 'END_OF_MONTH' | 'AFTER_DAYS' | 'BIWEEKLY';
export type RuleStatus = 'ACTIVE' | 'PAUSED' | 'COMPLETED' | 'CANCELLED';

export interface ScheduleRule {
  id: string;
  userId: string;
  recipientPhone: string;
  recipientName: string | null;
  amount: number;
  description: string;
  ruleType: RuleType;
  dayOfMonth: number | null; // for FIXED_DAY (1-28)
  intervalDays: number | null; // for AFTER_DAYS
  startDate: string;
  endDate: string | null;
  nextExecution: string;
  executionCount: number;
  maxExecutions: number | null;
  status: RuleStatus;
  lastExecutedAt: string | null;
  createdAt: string;
}

export class PaymentScheduleRulesService {
  async createRule(input: {
    userId: string;
    recipientPhone: string;
    recipientName?: string;
    amount: number;
    description: string;
    ruleType: RuleType;
    dayOfMonth?: number;
    intervalDays?: number;
    maxExecutions?: number;
    endDate?: string;
  }): Promise<ScheduleRule> {
    if (input.amount < 100) throw new Error('Monto mínimo: $100.');
    if (!input.description) throw new Error('Descripción requerida.');

    if (input.ruleType === 'FIXED_DAY' && (!input.dayOfMonth || input.dayOfMonth < 1 || input.dayOfMonth > 28)) {
      throw new Error('Día del mes debe ser entre 1 y 28.');
    }
    if (input.ruleType === 'AFTER_DAYS' && (!input.intervalDays || input.intervalDays < 1)) {
      throw new Error('Intervalo debe ser al menos 1 día.');
    }

    const rules = await this.getRules(input.userId);
    if (rules.length >= MAX_RULES) throw new Error(`Máximo ${MAX_RULES} reglas de pago.`);

    const rule: ScheduleRule = {
      id: `rule_${Date.now().toString(36)}`,
      userId: input.userId,
      recipientPhone: input.recipientPhone,
      recipientName: input.recipientName ?? null,
      amount: input.amount,
      description: input.description,
      ruleType: input.ruleType,
      dayOfMonth: input.dayOfMonth ?? null,
      intervalDays: input.intervalDays ?? null,
      startDate: new Date().toISOString(),
      endDate: input.endDate ?? null,
      nextExecution: this.calculateNext(input.ruleType, input.dayOfMonth, input.intervalDays),
      executionCount: 0,
      maxExecutions: input.maxExecutions ?? null,
      status: 'ACTIVE',
      lastExecutedAt: null,
      createdAt: new Date().toISOString(),
    };

    rules.push(rule);
    await this.save(input.userId, rules);

    log.info('Schedule rule created', { ruleId: rule.id, userId: input.userId, type: input.ruleType });
    return rule;
  }

  async getRules(userId: string): Promise<ScheduleRule[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${RULE_PREFIX}${userId}`);
      return raw ? JSON.parse(raw) as ScheduleRule[] : [];
    } catch {
      return [];
    }
  }

  async getDueRules(userId: string): Promise<ScheduleRule[]> {
    const rules = await this.getRules(userId);
    const now = new Date();
    return rules.filter(r =>
      r.status === 'ACTIVE' &&
      new Date(r.nextExecution) <= now &&
      (r.maxExecutions === null || r.executionCount < r.maxExecutions) &&
      (r.endDate === null || new Date(r.endDate) > now),
    );
  }

  async markExecuted(userId: string, ruleId: string): Promise<boolean> {
    const rules = await this.getRules(userId);
    const rule = rules.find(r => r.id === ruleId);
    if (!rule) return false;

    rule.executionCount++;
    rule.lastExecutedAt = new Date().toISOString();

    if (rule.maxExecutions && rule.executionCount >= rule.maxExecutions) {
      rule.status = 'COMPLETED';
    } else {
      rule.nextExecution = this.calculateNext(rule.ruleType, rule.dayOfMonth, rule.intervalDays);
    }

    await this.save(userId, rules);
    return true;
  }

  async pauseRule(userId: string, ruleId: string): Promise<boolean> {
    return this.setStatus(userId, ruleId, 'PAUSED');
  }

  async resumeRule(userId: string, ruleId: string): Promise<boolean> {
    const rules = await this.getRules(userId);
    const rule = rules.find(r => r.id === ruleId);
    if (!rule || rule.status !== 'PAUSED') return false;

    rule.status = 'ACTIVE';
    rule.nextExecution = this.calculateNext(rule.ruleType, rule.dayOfMonth, rule.intervalDays);
    await this.save(userId, rules);
    return true;
  }

  async cancelRule(userId: string, ruleId: string): Promise<boolean> {
    return this.setStatus(userId, ruleId, 'CANCELLED');
  }

  getRuleSummary(rule: ScheduleRule): string {
    const freq = this.getFrequencyLabel(rule);
    return `${rule.description} — ${formatCLP(rule.amount)} a ${rule.recipientName || rule.recipientPhone} — ${freq} — ${rule.status}`;
  }

  private getFrequencyLabel(rule: ScheduleRule): string {
    switch (rule.ruleType) {
      case 'FIXED_DAY': return `Día ${rule.dayOfMonth} de cada mes`;
      case 'END_OF_MONTH': return 'Fin de mes';
      case 'AFTER_DAYS': return `Cada ${rule.intervalDays} días`;
      case 'BIWEEKLY': return 'Quincenal (1 y 15)';
    }
  }

  private calculateNext(type: RuleType, dayOfMonth?: number | null, intervalDays?: number | null): string {
    const now = new Date();
    switch (type) {
      case 'FIXED_DAY': {
        const next = new Date(now.getFullYear(), now.getMonth(), dayOfMonth ?? 1);
        if (next <= now) next.setMonth(next.getMonth() + 1);
        return next.toISOString();
      }
      case 'END_OF_MONTH': {
        const next = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        if (next <= now) { next.setMonth(next.getMonth() + 1); next.setDate(0); }
        return next.toISOString();
      }
      case 'AFTER_DAYS': {
        const next = new Date(now.getTime() + (intervalDays ?? 7) * 24 * 60 * 60 * 1000);
        return next.toISOString();
      }
      case 'BIWEEKLY': {
        const day = now.getDate();
        const next = day < 15
          ? new Date(now.getFullYear(), now.getMonth(), 15)
          : new Date(now.getFullYear(), now.getMonth() + 1, 1);
        return next.toISOString();
      }
    }
  }

  private async setStatus(userId: string, ruleId: string, status: RuleStatus): Promise<boolean> {
    const rules = await this.getRules(userId);
    const rule = rules.find(r => r.id === ruleId);
    if (!rule) return false;
    rule.status = status;
    await this.save(userId, rules);
    return true;
  }

  private async save(userId: string, rules: ScheduleRule[]): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${RULE_PREFIX}${userId}`, JSON.stringify(rules), { EX: RULE_TTL });
    } catch (err) {
      log.warn('Failed to save rules', { userId, error: (err as Error).message });
    }
  }
}

export const paymentScheduleRules = new PaymentScheduleRulesService();
