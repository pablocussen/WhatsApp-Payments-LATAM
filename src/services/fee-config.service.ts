import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('fee-config');

// ─── Types ──────────────────────────────────────────────

export type PaymentMethod = 'WALLET' | 'WEBPAY_CREDIT' | 'WEBPAY_DEBIT' | 'KHIPU';

export interface FeeRule {
  method: PaymentMethod;
  percentFee: number;    // e.g., 2.8 means 2.8%
  fixedFee: number;      // e.g., 50 means $50 CLP
  minFee: number;        // floor
  maxFee: number;        // 0 = no cap
}

export interface FeeConfig {
  merchantId: string | null;  // null = platform default
  rules: FeeRule[];
  updatedAt: string;
}

export interface FeeCalculation {
  amount: number;
  method: PaymentMethod;
  percentFee: number;
  fixedFee: number;
  totalFee: number;
  netAmount: number;
}

const FEE_PREFIX = 'fees:merchant:';
const FEE_DEFAULT_KEY = 'fees:default';
const FEE_TTL = 365 * 24 * 60 * 60;

const PLATFORM_DEFAULTS: FeeRule[] = [
  { method: 'WALLET', percentFee: 0, fixedFee: 0, minFee: 0, maxFee: 0 },
  { method: 'WEBPAY_CREDIT', percentFee: 2.8, fixedFee: 50, minFee: 100, maxFee: 0 },
  { method: 'WEBPAY_DEBIT', percentFee: 1.8, fixedFee: 50, minFee: 100, maxFee: 0 },
  { method: 'KHIPU', percentFee: 1.0, fixedFee: 0, minFee: 50, maxFee: 0 },
];

// ─── Service ────────────────────────────────────────────

export class FeeConfigService {
  /**
   * Calculate fee for a transaction.
   */
  async calculateFee(merchantId: string | null, amount: number, method: PaymentMethod): Promise<FeeCalculation> {
    const rule = await this.getRule(merchantId, method);

    let totalFee = Math.round((amount * rule.percentFee) / 100) + rule.fixedFee;

    // Apply min/max
    if (rule.minFee > 0) totalFee = Math.max(totalFee, rule.minFee);
    if (rule.maxFee > 0) totalFee = Math.min(totalFee, rule.maxFee);

    return {
      amount,
      method,
      percentFee: rule.percentFee,
      fixedFee: rule.fixedFee,
      totalFee,
      netAmount: amount - totalFee,
    };
  }

  /**
   * Get fee rule for a specific method, with merchant override or platform default.
   */
  async getRule(merchantId: string | null, method: PaymentMethod): Promise<FeeRule> {
    if (merchantId) {
      const config = await this.getMerchantConfig(merchantId);
      if (config) {
        const rule = config.rules.find((r) => r.method === method);
        if (rule) return rule;
      }
    }

    // Fallback to custom defaults, then platform defaults
    const customDefaults = await this.getDefaultConfig();
    if (customDefaults) {
      const rule = customDefaults.rules.find((r) => r.method === method);
      if (rule) return rule;
    }

    return PLATFORM_DEFAULTS.find((r) => r.method === method) ?? PLATFORM_DEFAULTS[0];
  }

  /**
   * Set fee config for a merchant (admin action).
   */
  async setMerchantFees(merchantId: string, rules: FeeRule[]): Promise<FeeConfig> {
    this.validateRules(rules);

    const config: FeeConfig = {
      merchantId,
      rules,
      updatedAt: new Date().toISOString(),
    };

    try {
      const redis = getRedis();
      await redis.set(`${FEE_PREFIX}${merchantId}`, JSON.stringify(config), { EX: FEE_TTL });
    } catch (err) {
      log.warn('Failed to save merchant fees', { merchantId, error: (err as Error).message });
    }

    log.info('Merchant fee config updated', { merchantId, ruleCount: rules.length });
    return config;
  }

  /**
   * Set platform default fees (admin action).
   */
  async setDefaultFees(rules: FeeRule[]): Promise<FeeConfig> {
    this.validateRules(rules);

    const config: FeeConfig = {
      merchantId: null,
      rules,
      updatedAt: new Date().toISOString(),
    };

    try {
      const redis = getRedis();
      await redis.set(FEE_DEFAULT_KEY, JSON.stringify(config), { EX: FEE_TTL });
    } catch (err) {
      log.warn('Failed to save default fees', { error: (err as Error).message });
    }

    return config;
  }

  /**
   * Get merchant fee config.
   */
  async getMerchantConfig(merchantId: string): Promise<FeeConfig | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${FEE_PREFIX}${merchantId}`);
      if (!raw) return null;
      return JSON.parse(raw) as FeeConfig;
    } catch {
      return null;
    }
  }

  /**
   * Get custom platform defaults.
   */
  async getDefaultConfig(): Promise<FeeConfig | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(FEE_DEFAULT_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as FeeConfig;
    } catch {
      return null;
    }
  }

  /**
   * Remove merchant fee override, reverting to defaults.
   */
  async removeMerchantFees(merchantId: string): Promise<boolean> {
    try {
      const redis = getRedis();
      await redis.del(`${FEE_PREFIX}${merchantId}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the hardcoded platform defaults.
   */
  getPlatformDefaults(): FeeRule[] {
    return [...PLATFORM_DEFAULTS];
  }

  // ─── Helpers ────────────────────────────────────────────

  private validateRules(rules: FeeRule[]): void {
    if (!rules.length) throw new Error('Debe incluir al menos una regla');

    for (const rule of rules) {
      if (!['WALLET', 'WEBPAY_CREDIT', 'WEBPAY_DEBIT', 'KHIPU'].includes(rule.method)) {
        throw new Error(`Método de pago inválido: ${rule.method}`);
      }
      if (rule.percentFee < 0 || rule.percentFee > 50) {
        throw new Error('Comisión porcentual debe estar entre 0% y 50%');
      }
      if (rule.fixedFee < 0) throw new Error('Comisión fija no puede ser negativa');
      if (rule.minFee < 0) throw new Error('Comisión mínima no puede ser negativa');
      if (rule.maxFee < 0) throw new Error('Comisión máxima no puede ser negativa');
    }
  }
}

export const feeConfig = new FeeConfigService();
