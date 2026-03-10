import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { randomBytes } from 'crypto';

const log = createLogger('promotion');

// ─── Types ──────────────────────────────────────────────

export type PromotionType = 'percentage' | 'fixed' | 'cashback' | 'free_fee';
export type PromotionScope = 'global' | 'merchant' | 'user';

export interface Promotion {
  id: string;
  name: string;
  description: string;
  type: PromotionType;
  value: number;              // % for percentage/cashback, CLP for fixed
  minAmount: number;          // minimum transaction to apply
  maxDiscount: number;        // cap for percentage discounts (0 = no cap)
  scope: PromotionScope;
  scopeId: string | null;     // merchantId or userId when scoped
  code: string | null;        // promo code (null = auto-applied)
  usageLimit: number;         // max total uses (0 = unlimited)
  usageCount: number;
  perUserLimit: number;       // max uses per user (0 = unlimited)
  startDate: string;
  endDate: string;
  active: boolean;
  createdAt: string;
}

export interface AppliedPromotion {
  promotionId: string;
  name: string;
  type: PromotionType;
  discount: number;           // CLP amount saved
  originalAmount: number;
  finalAmount: number;
}

const PROMO_PREFIX = 'promo:';
const PROMO_INDEX = 'promo:index';
const PROMO_CODE = 'promo:code:';
const PROMO_USAGE = 'promo:usage:';
const PROMO_TTL = 365 * 24 * 60 * 60;

const VALID_TYPES: PromotionType[] = ['percentage', 'fixed', 'cashback', 'free_fee'];
const VALID_SCOPES: PromotionScope[] = ['global', 'merchant', 'user'];

// ─── Service ────────────────────────────────────────────

export class PromotionService {
  /**
   * Create a new promotion.
   */
  async createPromotion(input: {
    name: string;
    description?: string;
    type: PromotionType;
    value: number;
    minAmount?: number;
    maxDiscount?: number;
    scope?: PromotionScope;
    scopeId?: string;
    code?: string;
    usageLimit?: number;
    perUserLimit?: number;
    startDate: string;
    endDate: string;
  }): Promise<Promotion> {
    if (!input.name || input.name.length > 100) {
      throw new Error('Nombre debe tener entre 1 y 100 caracteres');
    }
    if (!VALID_TYPES.includes(input.type)) {
      throw new Error(`Tipo inválido: ${input.type}`);
    }
    if (input.value <= 0) {
      throw new Error('Valor debe ser positivo');
    }
    if (input.type === 'percentage' && input.value > 100) {
      throw new Error('Porcentaje no puede exceder 100%');
    }
    if (input.scope && !VALID_SCOPES.includes(input.scope)) {
      throw new Error(`Alcance inválido: ${input.scope}`);
    }
    if (new Date(input.endDate) <= new Date(input.startDate)) {
      throw new Error('Fecha de fin debe ser posterior a fecha de inicio');
    }

    const promo: Promotion = {
      id: `prm_${randomBytes(8).toString('hex')}`,
      name: input.name,
      description: input.description ?? '',
      type: input.type,
      value: input.value,
      minAmount: input.minAmount ?? 0,
      maxDiscount: input.maxDiscount ?? 0,
      scope: input.scope ?? 'global',
      scopeId: input.scopeId ?? null,
      code: input.code ?? null,
      usageLimit: input.usageLimit ?? 0,
      usageCount: 0,
      perUserLimit: input.perUserLimit ?? 0,
      startDate: input.startDate,
      endDate: input.endDate,
      active: true,
      createdAt: new Date().toISOString(),
    };

    try {
      const redis = getRedis();
      await redis.set(`${PROMO_PREFIX}${promo.id}`, JSON.stringify(promo), { EX: PROMO_TTL });

      // Index
      const idxRaw = await redis.get(PROMO_INDEX);
      const idx: string[] = idxRaw ? JSON.parse(idxRaw) : [];
      idx.push(promo.id);
      await redis.set(PROMO_INDEX, JSON.stringify(idx), { EX: PROMO_TTL });

      // Code lookup
      if (promo.code) {
        await redis.set(`${PROMO_CODE}${promo.code.toUpperCase()}`, promo.id, { EX: PROMO_TTL });
      }

      log.info('Promotion created', { id: promo.id, name: promo.name, type: promo.type });
    } catch (err) {
      log.warn('Failed to save promotion', { error: (err as Error).message });
    }

    return promo;
  }

  /**
   * Get promotion by ID.
   */
  async getPromotion(promoId: string): Promise<Promotion | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${PROMO_PREFIX}${promoId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * Find promotion by code.
   */
  async findByCode(code: string): Promise<Promotion | null> {
    try {
      const redis = getRedis();
      const promoId = await redis.get(`${PROMO_CODE}${code.toUpperCase()}`);
      if (!promoId) return null;
      return this.getPromotion(promoId);
    } catch {
      return null;
    }
  }

  /**
   * Apply a promotion to a transaction amount.
   */
  async applyPromotion(
    promoId: string,
    userId: string,
    amount: number,
  ): Promise<AppliedPromotion | null> {
    const promo = await this.getPromotion(promoId);
    if (!promo) return null;

    // Validation
    const now = new Date().toISOString();
    if (!promo.active) return null;
    if (now < promo.startDate || now > promo.endDate) return null;
    if (amount < promo.minAmount) return null;
    if (promo.usageLimit > 0 && promo.usageCount >= promo.usageLimit) return null;

    // Per-user limit check
    if (promo.perUserLimit > 0) {
      const userUsage = await this.getUserUsage(promoId, userId);
      if (userUsage >= promo.perUserLimit) return null;
    }

    // Calculate discount
    let discount = 0;
    switch (promo.type) {
      case 'percentage':
        discount = Math.floor(amount * promo.value / 100);
        if (promo.maxDiscount > 0) discount = Math.min(discount, promo.maxDiscount);
        break;
      case 'fixed':
        discount = Math.min(promo.value, amount);
        break;
      case 'cashback':
        discount = Math.floor(amount * promo.value / 100);
        if (promo.maxDiscount > 0) discount = Math.min(discount, promo.maxDiscount);
        break;
      case 'free_fee':
        discount = promo.value; // fee amount
        break;
    }

    // Record usage
    try {
      const redis = getRedis();
      promo.usageCount += 1;
      await redis.set(`${PROMO_PREFIX}${promoId}`, JSON.stringify(promo), { EX: PROMO_TTL });
      await this.incrementUserUsage(promoId, userId);
    } catch (err) {
      log.warn('Failed to record promo usage', { promoId, userId, error: (err as Error).message });
    }

    return {
      promotionId: promo.id,
      name: promo.name,
      type: promo.type,
      discount,
      originalAmount: amount,
      finalAmount: amount - discount,
    };
  }

  /**
   * List active promotions.
   */
  async listActive(): Promise<Promotion[]> {
    try {
      const redis = getRedis();
      const idxRaw = await redis.get(PROMO_INDEX);
      if (!idxRaw) return [];

      const ids: string[] = JSON.parse(idxRaw);
      const promos: Promotion[] = [];
      const now = new Date().toISOString();

      for (const id of ids) {
        const raw = await redis.get(`${PROMO_PREFIX}${id}`);
        if (raw) {
          const p: Promotion = JSON.parse(raw);
          if (p.active && now >= p.startDate && now <= p.endDate) {
            promos.push(p);
          }
        }
      }

      return promos;
    } catch {
      return [];
    }
  }

  /**
   * Deactivate a promotion.
   */
  async deactivatePromotion(promoId: string): Promise<boolean> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${PROMO_PREFIX}${promoId}`);
      if (!raw) return false;

      const promo: Promotion = JSON.parse(raw);
      promo.active = false;
      await redis.set(`${PROMO_PREFIX}${promoId}`, JSON.stringify(promo), { EX: PROMO_TTL });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get promotion usage stats.
   */
  async getUsageStats(promoId: string): Promise<{
    totalUses: number;
    usageLimit: number;
    remaining: number;
  } | null> {
    const promo = await this.getPromotion(promoId);
    if (!promo) return null;
    return {
      totalUses: promo.usageCount,
      usageLimit: promo.usageLimit,
      remaining: promo.usageLimit > 0 ? Math.max(0, promo.usageLimit - promo.usageCount) : -1,
    };
  }

  // ─── Helpers ────────────────────────────────────────────

  private async getUserUsage(promoId: string, userId: string): Promise<number> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${PROMO_USAGE}${promoId}:${userId}`);
      return raw ? parseInt(raw, 10) : 0;
    } catch {
      return 0;
    }
  }

  private async incrementUserUsage(promoId: string, userId: string): Promise<void> {
    try {
      const redis = getRedis();
      const current = await this.getUserUsage(promoId, userId);
      await redis.set(`${PROMO_USAGE}${promoId}:${userId}`, String(current + 1), { EX: PROMO_TTL });
    } catch {
      // Silent
    }
  }
}

export const promotions = new PromotionService();
