import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-achievement');
const PREFIX = 'user:achievement:';
const TTL = 2 * 365 * 24 * 60 * 60;

export type AchievementCategory = 'PAYMENTS' | 'SAVINGS' | 'REFERRAL' | 'MERCHANT' | 'SOCIAL';
export type AchievementTier = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';

export interface Achievement {
  id: string;
  code: string;
  category: AchievementCategory;
  tier: AchievementTier;
  name: string;
  description: string;
  pointsAwarded: number;
  unlockedAt: string;
}

const CATALOG: Omit<Achievement, 'id' | 'unlockedAt'>[] = [
  { code: 'FIRST_PAYMENT', category: 'PAYMENTS', tier: 'BRONZE', name: 'Primer Pago', description: 'Enviaste tu primer pago', pointsAwarded: 50 },
  { code: 'PAY_10', category: 'PAYMENTS', tier: 'BRONZE', name: 'Activo', description: '10 pagos enviados', pointsAwarded: 100 },
  { code: 'PAY_100', category: 'PAYMENTS', tier: 'SILVER', name: 'Frecuente', description: '100 pagos enviados', pointsAwarded: 500 },
  { code: 'PAY_1000', category: 'PAYMENTS', tier: 'GOLD', name: 'Experto', description: '1000 pagos enviados', pointsAwarded: 2000 },
  { code: 'SAVE_10K', category: 'SAVINGS', tier: 'BRONZE', name: 'Ahorrador', description: 'Ahorraste $10.000', pointsAwarded: 100 },
  { code: 'SAVE_100K', category: 'SAVINGS', tier: 'SILVER', name: 'Disciplinado', description: 'Ahorraste $100.000', pointsAwarded: 500 },
  { code: 'SAVE_1M', category: 'SAVINGS', tier: 'GOLD', name: 'Millonario', description: 'Ahorraste $1.000.000', pointsAwarded: 2000 },
  { code: 'REFER_1', category: 'REFERRAL', tier: 'BRONZE', name: 'Embajador', description: 'Primer referido registrado', pointsAwarded: 150 },
  { code: 'REFER_10', category: 'REFERRAL', tier: 'SILVER', name: 'Reclutador', description: '10 referidos activos', pointsAwarded: 750 },
  { code: 'REFER_50', category: 'REFERRAL', tier: 'PLATINUM', name: 'Viral', description: '50 referidos activos', pointsAwarded: 5000 },
  { code: 'STREAK_30', category: 'PAYMENTS', tier: 'SILVER', name: 'Constante', description: '30 dias consecutivos usando WhatPay', pointsAwarded: 500 },
  { code: 'STREAK_100', category: 'PAYMENTS', tier: 'GOLD', name: 'Inquebrantable', description: '100 dias consecutivos', pointsAwarded: 2000 },
];

export class UserAchievementService {
  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  async list(userId: string): Promise<Achievement[]> {
    const raw = await getRedis().get(this.key(userId));
    return raw ? JSON.parse(raw) : [];
  }

  getCatalog(): Omit<Achievement, 'id' | 'unlockedAt'>[] {
    return CATALOG;
  }

  async unlock(userId: string, code: string): Promise<Achievement | null> {
    const template = CATALOG.find(c => c.code === code);
    if (!template) throw new Error(`Achievement ${code} no existe`);
    const list = await this.list(userId);
    if (list.some(a => a.code === code)) return null;
    const achievement: Achievement = {
      ...template,
      id: `ach_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      unlockedAt: new Date().toISOString(),
    };
    list.push(achievement);
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    log.info('achievement unlocked', { userId, code });
    return achievement;
  }

  async isUnlocked(userId: string, code: string): Promise<boolean> {
    const list = await this.list(userId);
    return list.some(a => a.code === code);
  }

  async getTotalPoints(userId: string): Promise<number> {
    const list = await this.list(userId);
    return list.reduce((sum, a) => sum + a.pointsAwarded, 0);
  }

  async getByCategory(userId: string, category: AchievementCategory): Promise<Achievement[]> {
    const list = await this.list(userId);
    return list.filter(a => a.category === category);
  }

  async getByTier(userId: string, tier: AchievementTier): Promise<Achievement[]> {
    const list = await this.list(userId);
    return list.filter(a => a.tier === tier);
  }

  async getProgress(userId: string): Promise<{
    unlocked: number;
    total: number;
    percentage: number;
    byTier: Record<AchievementTier, { unlocked: number; total: number }>;
  }> {
    const list = await this.list(userId);
    const byTier: Record<AchievementTier, { unlocked: number; total: number }> = {
      BRONZE: { unlocked: 0, total: 0 },
      SILVER: { unlocked: 0, total: 0 },
      GOLD: { unlocked: 0, total: 0 },
      PLATINUM: { unlocked: 0, total: 0 },
    };
    for (const c of CATALOG) byTier[c.tier].total++;
    for (const a of list) byTier[a.tier].unlocked++;
    return {
      unlocked: list.length,
      total: CATALOG.length,
      percentage: Math.round((list.length / CATALOG.length) * 100),
      byTier,
    };
  }
}

export const userAchievement = new UserAchievementService();
