import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('merchant-sub-plan');
const SUB_PREFIX = 'msubplan:';
const SUB_TTL = 365 * 24 * 60 * 60;

export type PlanTier = 'FREE' | 'PRO' | 'BUSINESS' | 'ENTERPRISE';
export type BillingCycle = 'MONTHLY' | 'ANNUAL';

export interface SubscriptionPlan {
  merchantId: string;
  tier: PlanTier;
  billingCycle: BillingCycle;
  price: number;
  startDate: string;
  nextBillingDate: string;
  features: string[];
  maxTeamMembers: number;
  maxProducts: number;
  maxMonthlyTx: number;
  apiAccess: boolean;
  webhookAccess: boolean;
  prioritySupport: boolean;
  active: boolean;
  cancelledAt: string | null;
}

const PLAN_CONFIG: Record<PlanTier, Omit<SubscriptionPlan, 'merchantId' | 'billingCycle' | 'startDate' | 'nextBillingDate' | 'active' | 'cancelledAt' | 'price'>> = {
  FREE: { tier: 'FREE', features: ['Pagos', 'Links', 'QR'], maxTeamMembers: 1, maxProducts: 20, maxMonthlyTx: 100, apiAccess: false, webhookAccess: false, prioritySupport: false },
  PRO: { tier: 'PRO', features: ['Pagos', 'Links', 'QR', 'Analytics', 'Cupones', 'Multi-usuario'], maxTeamMembers: 5, maxProducts: 100, maxMonthlyTx: 1000, apiAccess: true, webhookAccess: false, prioritySupport: false },
  BUSINESS: { tier: 'BUSINESS', features: ['Todo PRO', 'Webhooks', 'Branding', 'Facturas', 'Soporte prioritario'], maxTeamMembers: 20, maxProducts: 500, maxMonthlyTx: 10000, apiAccess: true, webhookAccess: true, prioritySupport: true },
  ENTERPRISE: { tier: 'ENTERPRISE', features: ['Todo BUSINESS', 'SLA 99.9%', 'Account Manager', 'Custom integrations'], maxTeamMembers: 100, maxProducts: 10000, maxMonthlyTx: 100000, apiAccess: true, webhookAccess: true, prioritySupport: true },
};

const PRICES: Record<PlanTier, Record<BillingCycle, number>> = {
  FREE: { MONTHLY: 0, ANNUAL: 0 },
  PRO: { MONTHLY: 19990, ANNUAL: 199900 },
  BUSINESS: { MONTHLY: 49990, ANNUAL: 499900 },
  ENTERPRISE: { MONTHLY: 149990, ANNUAL: 1499900 },
};

export class MerchantSubscriptionPlanService {
  async subscribe(merchantId: string, tier: PlanTier, billingCycle: BillingCycle): Promise<SubscriptionPlan> {
    if (!PLAN_CONFIG[tier]) throw new Error('Plan no existe.');
    const config = PLAN_CONFIG[tier];
    const price = PRICES[tier][billingCycle];
    const nextBilling = new Date();
    nextBilling.setMonth(nextBilling.getMonth() + (billingCycle === 'ANNUAL' ? 12 : 1));

    const plan: SubscriptionPlan = {
      merchantId, ...config, billingCycle, price,
      startDate: new Date().toISOString(), nextBillingDate: nextBilling.toISOString(),
      active: true, cancelledAt: null,
    };
    try { const redis = getRedis(); await redis.set(`${SUB_PREFIX}${merchantId}`, JSON.stringify(plan), { EX: SUB_TTL }); }
    catch (err) { log.warn('Failed to save subscription', { merchantId, error: (err as Error).message }); }
    log.info('Subscription created', { merchantId, tier, billingCycle });
    return plan;
  }

  async getPlan(merchantId: string): Promise<SubscriptionPlan> {
    try { const redis = getRedis(); const raw = await redis.get(`${SUB_PREFIX}${merchantId}`); if (raw) return JSON.parse(raw) as SubscriptionPlan; }
    catch { /* default free */ }
    return { merchantId, ...PLAN_CONFIG.FREE, billingCycle: 'MONTHLY', price: 0, startDate: new Date().toISOString(), nextBillingDate: '', active: true, cancelledAt: null };
  }

  async cancelPlan(merchantId: string): Promise<boolean> {
    const plan = await this.getPlan(merchantId);
    if (plan.tier === 'FREE') return false;
    plan.active = false; plan.cancelledAt = new Date().toISOString();
    try { const redis = getRedis(); await redis.set(`${SUB_PREFIX}${merchantId}`, JSON.stringify(plan), { EX: SUB_TTL }); }
    catch { return false; }
    return true;
  }

  async upgradePlan(merchantId: string, newTier: PlanTier): Promise<SubscriptionPlan> {
    const current = await this.getPlan(merchantId);
    const tiers: PlanTier[] = ['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE'];
    if (tiers.indexOf(newTier) <= tiers.indexOf(current.tier)) throw new Error('Solo se puede subir de plan.');
    return this.subscribe(merchantId, newTier, current.billingCycle);
  }

  canAccess(plan: SubscriptionPlan, feature: string): boolean {
    if (!plan.active) return false;
    if (feature === 'api' && !plan.apiAccess) return false;
    if (feature === 'webhook' && !plan.webhookAccess) return false;
    if (feature === 'priority_support' && !plan.prioritySupport) return false;
    return true;
  }

  formatPlanSummary(plan: SubscriptionPlan): string {
    return `${plan.tier} (${plan.billingCycle}) — ${plan.price === 0 ? 'Gratis' : formatCLP(plan.price) + '/mes'} — ${plan.features.length} features — ${plan.active ? 'Activo' : 'Cancelado'}`;
  }

  getAvailablePlans(): { tier: PlanTier; monthlyPrice: number; annualPrice: number; features: string[] }[] {
    return (['FREE', 'PRO', 'BUSINESS', 'ENTERPRISE'] as PlanTier[]).map(tier => ({
      tier, monthlyPrice: PRICES[tier].MONTHLY, annualPrice: PRICES[tier].ANNUAL, features: PLAN_CONFIG[tier].features,
    }));
  }
}

export const merchantSubscriptionPlan = new MerchantSubscriptionPlanService();
