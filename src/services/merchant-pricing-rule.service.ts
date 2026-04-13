import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-pricing-rule');
const PREFIX = 'merchant:pricing-rule:';
const TTL = 365 * 24 * 60 * 60;

export type RuleType = 'BULK_DISCOUNT' | 'TIME_BASED' | 'CUSTOMER_TIER' | 'MIN_ORDER';
export type DiscountType = 'PERCENTAGE' | 'FIXED';

export interface PricingRule {
  id: string;
  merchantId: string;
  name: string;
  ruleType: RuleType;
  active: boolean;
  priority: number;
  discountType: DiscountType;
  discountValue: number;
  minQuantity?: number;
  minOrderAmount?: number;
  startHour?: number;
  endHour?: number;
  customerTier?: string;
  timesApplied: number;
  createdAt: string;
}

export class MerchantPricingRuleService {
  private key(merchantId: string): string {
    return `${PREFIX}${merchantId}`;
  }

  async list(merchantId: string): Promise<PricingRule[]> {
    const raw = await getRedis().get(this.key(merchantId));
    return raw ? JSON.parse(raw) : [];
  }

  async create(input: {
    merchantId: string;
    name: string;
    ruleType: RuleType;
    priority: number;
    discountType: DiscountType;
    discountValue: number;
    minQuantity?: number;
    minOrderAmount?: number;
    startHour?: number;
    endHour?: number;
    customerTier?: string;
  }): Promise<PricingRule> {
    if (input.name.length > 60) throw new Error('Nombre excede 60 caracteres');
    if (input.discountValue <= 0) throw new Error('Descuento debe ser positivo');
    if (input.discountType === 'PERCENTAGE' && input.discountValue > 100) {
      throw new Error('Porcentaje no puede exceder 100');
    }
    if (input.priority < 0 || input.priority > 100) {
      throw new Error('Prioridad entre 0 y 100');
    }
    if (input.ruleType === 'BULK_DISCOUNT' && (!input.minQuantity || input.minQuantity < 2)) {
      throw new Error('Bulk discount requiere minQuantity >= 2');
    }
    if (input.ruleType === 'TIME_BASED') {
      if (input.startHour === undefined || input.endHour === undefined) {
        throw new Error('Time based requiere startHour y endHour');
      }
      if (input.startHour < 0 || input.startHour > 23 || input.endHour < 0 || input.endHour > 23) {
        throw new Error('Horas entre 0 y 23');
      }
    }
    if (input.ruleType === 'MIN_ORDER' && (!input.minOrderAmount || input.minOrderAmount <= 0)) {
      throw new Error('Min order requiere minOrderAmount positivo');
    }
    const list = await this.list(input.merchantId);
    if (list.length >= 20) throw new Error('Maximo 20 reglas por comercio');
    const rule: PricingRule = {
      id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      merchantId: input.merchantId,
      name: input.name,
      ruleType: input.ruleType,
      active: true,
      priority: input.priority,
      discountType: input.discountType,
      discountValue: input.discountValue,
      minQuantity: input.minQuantity,
      minOrderAmount: input.minOrderAmount,
      startHour: input.startHour,
      endHour: input.endHour,
      customerTier: input.customerTier,
      timesApplied: 0,
      createdAt: new Date().toISOString(),
    };
    list.push(rule);
    await getRedis().set(this.key(input.merchantId), JSON.stringify(list), { EX: TTL });
    log.info('pricing rule created', { id: rule.id, type: rule.ruleType });
    return rule;
  }

  async toggleActive(merchantId: string, id: string): Promise<PricingRule | null> {
    const list = await this.list(merchantId);
    const rule = list.find(r => r.id === id);
    if (!rule) return null;
    rule.active = !rule.active;
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return rule;
  }

  async delete(merchantId: string, id: string): Promise<boolean> {
    const list = await this.list(merchantId);
    const idx = list.findIndex(r => r.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return true;
  }

  private isRuleApplicable(rule: PricingRule, context: {
    quantity?: number;
    orderAmount?: number;
    hour?: number;
    customerTier?: string;
  }): boolean {
    if (!rule.active) return false;
    switch (rule.ruleType) {
      case 'BULK_DISCOUNT':
        return context.quantity !== undefined && rule.minQuantity !== undefined && context.quantity >= rule.minQuantity;
      case 'MIN_ORDER':
        return context.orderAmount !== undefined && rule.minOrderAmount !== undefined && context.orderAmount >= rule.minOrderAmount;
      case 'TIME_BASED':
        return context.hour !== undefined && rule.startHour !== undefined && rule.endHour !== undefined
          && context.hour >= rule.startHour && context.hour <= rule.endHour;
      case 'CUSTOMER_TIER':
        return context.customerTier !== undefined && rule.customerTier === context.customerTier;
    }
  }

  async findBestRule(merchantId: string, context: {
    quantity?: number;
    orderAmount?: number;
    hour?: number;
    customerTier?: string;
  }): Promise<PricingRule | null> {
    const list = await this.list(merchantId);
    const applicable = list.filter(r => this.isRuleApplicable(r, context));
    if (applicable.length === 0) return null;
    return applicable.sort((a, b) => b.priority - a.priority)[0];
  }

  async applyDiscount(baseAmount: number, rule: PricingRule): Promise<number> {
    if (rule.discountType === 'PERCENTAGE') {
      return Math.round(baseAmount * (1 - rule.discountValue / 100));
    }
    return Math.max(0, baseAmount - rule.discountValue);
  }

  async recordApplication(merchantId: string, id: string): Promise<PricingRule | null> {
    const list = await this.list(merchantId);
    const rule = list.find(r => r.id === id);
    if (!rule) return null;
    rule.timesApplied++;
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return rule;
  }
}

export const merchantPricingRule = new MerchantPricingRuleService();
