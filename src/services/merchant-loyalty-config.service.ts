import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-loyalty');

const MLOY_PREFIX = 'mloycfg:';
const MLOY_TTL = 365 * 24 * 60 * 60;

export interface LoyaltyTier {
  name: string;
  minPoints: number;
  multiplier: number; // points multiplier (e.g. 1.5x)
  perks: string[];
}

export interface MerchantLoyaltyConfig {
  merchantId: string;
  enabled: boolean;
  pointsPerCLP: number; // e.g. 1 point per $100 CLP
  tiers: LoyaltyTier[];
  redeemRate: number; // points to CLP (e.g. 100 points = $1 CLP)
  welcomeBonus: number;
  birthdayBonus: number;
  updatedAt: string;
}

const DEFAULT_TIERS: LoyaltyTier[] = [
  { name: 'Bronce', minPoints: 0, multiplier: 1, perks: ['Acumula puntos'] },
  { name: 'Plata', minPoints: 500, multiplier: 1.5, perks: ['Acumula 1.5x puntos', 'Descuento 5% primer viernes'] },
  { name: 'Oro', minPoints: 2000, multiplier: 2, perks: ['Acumula 2x puntos', 'Envío gratis', 'Descuento 10%'] },
  { name: 'Platino', minPoints: 5000, multiplier: 3, perks: ['Acumula 3x puntos', 'Acceso VIP', 'Descuento 15%'] },
];

export class MerchantLoyaltyConfigService {
  async getConfig(merchantId: string): Promise<MerchantLoyaltyConfig> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${MLOY_PREFIX}${merchantId}`);
      if (raw) return JSON.parse(raw) as MerchantLoyaltyConfig;
    } catch { /* defaults */ }

    return {
      merchantId,
      enabled: false,
      pointsPerCLP: 1, // 1 point per $100
      tiers: [...DEFAULT_TIERS],
      redeemRate: 100, // 100 points = $1
      welcomeBonus: 100,
      birthdayBonus: 500,
      updatedAt: new Date().toISOString(),
    };
  }

  async updateConfig(merchantId: string, updates: Partial<Omit<MerchantLoyaltyConfig, 'merchantId' | 'updatedAt'>>): Promise<MerchantLoyaltyConfig> {
    const config = await this.getConfig(merchantId);

    if (updates.enabled !== undefined) config.enabled = updates.enabled;
    if (updates.pointsPerCLP !== undefined) {
      if (updates.pointsPerCLP < 0.01) throw new Error('Puntos por CLP debe ser mayor a 0.');
      config.pointsPerCLP = updates.pointsPerCLP;
    }
    if (updates.tiers !== undefined) {
      if (updates.tiers.length > 6) throw new Error('Máximo 6 niveles.');
      config.tiers = updates.tiers;
    }
    if (updates.redeemRate !== undefined) config.redeemRate = updates.redeemRate;
    if (updates.welcomeBonus !== undefined) config.welcomeBonus = updates.welcomeBonus;
    if (updates.birthdayBonus !== undefined) config.birthdayBonus = updates.birthdayBonus;
    config.updatedAt = new Date().toISOString();

    try {
      const redis = getRedis();
      await redis.set(`${MLOY_PREFIX}${merchantId}`, JSON.stringify(config), { EX: MLOY_TTL });
    } catch (err) {
      log.warn('Failed to save loyalty config', { merchantId, error: (err as Error).message });
    }

    log.info('Loyalty config updated', { merchantId, enabled: config.enabled });
    return config;
  }

  calculatePoints(config: MerchantLoyaltyConfig, amount: number, currentPoints: number): number {
    if (!config.enabled) return 0;
    const tier = this.getTier(config, currentPoints);
    const basePoints = Math.floor(amount / 100 * config.pointsPerCLP);
    return Math.round(basePoints * tier.multiplier);
  }

  getTier(config: MerchantLoyaltyConfig, points: number): LoyaltyTier {
    const sorted = [...config.tiers].sort((a, b) => b.minPoints - a.minPoints);
    return sorted.find(t => points >= t.minPoints) ?? config.tiers[0];
  }

  pointsToCLP(config: MerchantLoyaltyConfig, points: number): number {
    return Math.floor(points / config.redeemRate);
  }
}

export const merchantLoyaltyConfig = new MerchantLoyaltyConfigService();
