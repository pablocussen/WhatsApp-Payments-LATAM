import { randomBytes } from 'crypto';
import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('recurring-payments');

// ─── Types ──────────────────────────────────────────────

export type RecurringFrequency = 'weekly' | 'biweekly' | 'monthly';

export interface RecurringPlan {
  id: string;
  merchantId: string;
  subscriberId: string;
  amount: number;
  frequency: RecurringFrequency;
  description: string;
  status: 'active' | 'paused' | 'cancelled';
  nextChargeDate: string;       // ISO date string YYYY-MM-DD
  createdAt: string;
  lastChargedAt: string | null;
  totalCharged: number;
  chargeCount: number;
}

export interface CreatePlanInput {
  merchantId: string;
  subscriberId: string;
  amount: number;
  frequency: RecurringFrequency;
  description: string;
}

const PLANS_PREFIX = 'recurring:plans:';
const USER_PLANS_PREFIX = 'recurring:user:';
const PLANS_TTL = 365 * 24 * 60 * 60;
const MAX_PLANS_PER_USER = 10;

// ─── Service ────────────────────────────────────────────

export class RecurringPaymentService {
  /**
   * Create a recurring payment plan (subscription).
   */
  async createPlan(input: CreatePlanInput): Promise<RecurringPlan> {
    if (input.amount < 100) {
      throw new Error('Monto mínimo para suscripción es $100');
    }
    if (input.amount > 50_000_000) {
      throw new Error('Monto máximo para suscripción es $50.000.000');
    }
    if (!input.description || input.description.length > 100) {
      throw new Error('Descripción debe tener entre 1 y 100 caracteres');
    }

    const userPlans = await this.getUserPlans(input.subscriberId);
    if (userPlans.length >= MAX_PLANS_PER_USER) {
      throw new Error(`Máximo ${MAX_PLANS_PER_USER} suscripciones por usuario`);
    }

    const plan: RecurringPlan = {
      id: `sub_${randomBytes(8).toString('hex')}`,
      merchantId: input.merchantId,
      subscriberId: input.subscriberId,
      amount: input.amount,
      frequency: input.frequency,
      description: input.description,
      status: 'active',
      nextChargeDate: this.computeNextDate(input.frequency),
      createdAt: new Date().toISOString(),
      lastChargedAt: null,
      totalCharged: 0,
      chargeCount: 0,
    };

    try {
      const redis = getRedis();
      // Store plan by ID
      await redis.set(`${PLANS_PREFIX}${plan.id}`, JSON.stringify(plan), { EX: PLANS_TTL });
      // Index by subscriber
      const plans = [...userPlans, plan];
      await redis.set(`${USER_PLANS_PREFIX}${input.subscriberId}`, JSON.stringify(plans.map((p) => p.id)), { EX: PLANS_TTL });
    } catch (err) {
      log.warn('Failed to save recurring plan', { error: (err as Error).message });
    }

    log.info('Recurring plan created', {
      planId: plan.id,
      merchantId: input.merchantId,
      subscriberId: input.subscriberId,
      amount: input.amount,
      frequency: input.frequency,
    });

    return plan;
  }

  /**
   * Get a plan by ID.
   */
  async getPlan(planId: string): Promise<RecurringPlan | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${PLANS_PREFIX}${planId}`);
      if (!raw) return null;
      return JSON.parse(raw) as RecurringPlan;
    } catch {
      return null;
    }
  }

  /**
   * Get all plans for a subscriber.
   */
  async getUserPlans(subscriberId: string): Promise<RecurringPlan[]> {
    try {
      const redis = getRedis();
      const idsRaw = await redis.get(`${USER_PLANS_PREFIX}${subscriberId}`);
      if (!idsRaw) return [];

      const ids = JSON.parse(idsRaw) as string[];
      const plans: RecurringPlan[] = [];

      for (const id of ids) {
        const plan = await this.getPlan(id);
        if (plan) plans.push(plan);
      }

      return plans;
    } catch {
      return [];
    }
  }

  /**
   * Pause a plan.
   */
  async pausePlan(planId: string, subscriberId: string): Promise<boolean> {
    const plan = await this.getPlan(planId);
    if (!plan || plan.subscriberId !== subscriberId) return false;
    if (plan.status !== 'active') return false;

    plan.status = 'paused';
    return this.savePlan(plan);
  }

  /**
   * Resume a paused plan.
   */
  async resumePlan(planId: string, subscriberId: string): Promise<boolean> {
    const plan = await this.getPlan(planId);
    if (!plan || plan.subscriberId !== subscriberId) return false;
    if (plan.status !== 'paused') return false;

    plan.status = 'active';
    plan.nextChargeDate = this.computeNextDate(plan.frequency);
    return this.savePlan(plan);
  }

  /**
   * Cancel a plan permanently.
   */
  async cancelPlan(planId: string, subscriberId: string): Promise<boolean> {
    const plan = await this.getPlan(planId);
    if (!plan || plan.subscriberId !== subscriberId) return false;
    if (plan.status === 'cancelled') return false;

    plan.status = 'cancelled';
    return this.savePlan(plan);
  }

  /**
   * Record a successful charge on a plan.
   */
  async recordCharge(planId: string): Promise<RecurringPlan | null> {
    const plan = await this.getPlan(planId);
    if (!plan || plan.status !== 'active') return null;

    plan.lastChargedAt = new Date().toISOString();
    plan.totalCharged += plan.amount;
    plan.chargeCount += 1;
    plan.nextChargeDate = this.computeNextDate(plan.frequency);

    const saved = await this.savePlan(plan);
    if (!saved) return null;

    log.info('Recurring charge recorded', {
      planId,
      amount: formatCLP(plan.amount),
      chargeCount: plan.chargeCount,
    });

    return plan;
  }

  /**
   * Get all active plans due for charging (nextChargeDate <= today).
   */
  async getDuePlans(subscriberId: string): Promise<RecurringPlan[]> {
    const plans = await this.getUserPlans(subscriberId);
    const today = new Date().toISOString().slice(0, 10);
    return plans.filter((p) => p.status === 'active' && p.nextChargeDate <= today);
  }

  // ─── Helpers ────────────────────────────────────────────

  private async savePlan(plan: RecurringPlan): Promise<boolean> {
    try {
      const redis = getRedis();
      await redis.set(`${PLANS_PREFIX}${plan.id}`, JSON.stringify(plan), { EX: PLANS_TTL });
      return true;
    } catch (err) {
      log.warn('Failed to save plan', { planId: plan.id, error: (err as Error).message });
      return false;
    }
  }

  computeNextDate(frequency: RecurringFrequency, from?: Date): string {
    const base = from ?? new Date();
    const next = new Date(base);

    switch (frequency) {
      case 'weekly':
        next.setDate(next.getDate() + 7);
        break;
      case 'biweekly':
        next.setDate(next.getDate() + 14);
        break;
      case 'monthly':
        next.setMonth(next.getMonth() + 1);
        break;
    }

    return next.toISOString().slice(0, 10);
  }
}

export const recurringPayments = new RecurringPaymentService();
