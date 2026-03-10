import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { randomBytes } from 'crypto';

const log = createLogger('loyalty');

// ─── Types ──────────────────────────────────────────────

export type RewardTier = 'BRONCE' | 'PLATA' | 'ORO' | 'PLATINO';

export interface LoyaltyAccount {
  userId: string;
  points: number;
  lifetimePoints: number;
  tier: RewardTier;
  lastEarnedAt: string | null;
  createdAt: string;
}

export interface PointsTransaction {
  id: string;
  userId: string;
  type: 'earn' | 'redeem' | 'expire' | 'bonus';
  points: number;
  description: string;
  reference: string | null;
  createdAt: string;
}

export interface RewardItem {
  id: string;
  name: string;
  description: string;
  pointsCost: number;
  category: string;
  active: boolean;
}

// Tier thresholds (lifetime points)
const TIER_THRESHOLDS: Record<RewardTier, number> = {
  BRONCE: 0,
  PLATA: 5000,
  ORO: 25000,
  PLATINO: 100000,
};

// Points earned per CLP spent
const POINTS_PER_CLP = 0.01; // 1 point per $100 CLP

// Tier multipliers
const TIER_MULTIPLIERS: Record<RewardTier, number> = {
  BRONCE: 1.0,
  PLATA: 1.25,
  ORO: 1.5,
  PLATINO: 2.0,
};

const LOYALTY_PREFIX = 'loyalty:';
const HISTORY_PREFIX = 'loyalty:history:';
const REWARDS_KEY = 'loyalty:rewards';
const LOYALTY_TTL = 365 * 24 * 60 * 60; // 1 year

// ─── Service ────────────────────────────────────────────

export class LoyaltyService {
  /**
   * Get or create loyalty account for a user.
   */
  async getAccount(userId: string): Promise<LoyaltyAccount> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${LOYALTY_PREFIX}${userId}`);
      if (raw) return JSON.parse(raw);
    } catch {
      // Fall through to create default
    }

    const account: LoyaltyAccount = {
      userId,
      points: 0,
      lifetimePoints: 0,
      tier: 'BRONCE',
      lastEarnedAt: null,
      createdAt: new Date().toISOString(),
    };
    return account;
  }

  /**
   * Earn points for a transaction amount.
   */
  async earnPoints(
    userId: string,
    amount: number,
    reference: string | null = null,
    description = 'Puntos por transacción',
  ): Promise<{ earned: number; total: number; tier: RewardTier; tierChanged: boolean }> {
    if (amount < 100) {
      return { earned: 0, total: 0, tier: 'BRONCE', tierChanged: false };
    }

    const account = await this.getAccount(userId);
    const basePoints = Math.floor(amount * POINTS_PER_CLP);
    const multiplier = TIER_MULTIPLIERS[account.tier];
    const earned = Math.floor(basePoints * multiplier);

    const oldTier = account.tier;
    account.points += earned;
    account.lifetimePoints += earned;
    account.tier = this.calculateTier(account.lifetimePoints);
    account.lastEarnedAt = new Date().toISOString();

    const tierChanged = oldTier !== account.tier;

    try {
      const redis = getRedis();
      await redis.set(`${LOYALTY_PREFIX}${userId}`, JSON.stringify(account), { EX: LOYALTY_TTL });

      // Record transaction
      const txn: PointsTransaction = {
        id: `lpt_${randomBytes(8).toString('hex')}`,
        userId,
        type: 'earn',
        points: earned,
        description,
        reference,
        createdAt: new Date().toISOString(),
      };
      await this.appendHistory(userId, txn);

      if (tierChanged) {
        log.info('Tier upgraded', { userId, from: oldTier, to: account.tier });
      }
    } catch (err) {
      log.warn('Failed to save loyalty points', { userId, error: (err as Error).message });
    }

    return { earned, total: account.points, tier: account.tier, tierChanged };
  }

  /**
   * Redeem points for a reward.
   */
  async redeemPoints(
    userId: string,
    points: number,
    description = 'Canje de puntos',
  ): Promise<{ success: boolean; remaining: number; message: string }> {
    if (points <= 0) {
      return { success: false, remaining: 0, message: 'Cantidad de puntos inválida' };
    }

    const account = await this.getAccount(userId);

    if (account.points < points) {
      return {
        success: false,
        remaining: account.points,
        message: `Puntos insuficientes. Tienes ${account.points}, necesitas ${points}`,
      };
    }

    account.points -= points;

    try {
      const redis = getRedis();
      await redis.set(`${LOYALTY_PREFIX}${userId}`, JSON.stringify(account), { EX: LOYALTY_TTL });

      const txn: PointsTransaction = {
        id: `lpt_${randomBytes(8).toString('hex')}`,
        userId,
        type: 'redeem',
        points: -points,
        description,
        reference: null,
        createdAt: new Date().toISOString(),
      };
      await this.appendHistory(userId, txn);
    } catch (err) {
      log.warn('Failed to save redemption', { userId, error: (err as Error).message });
    }

    return { success: true, remaining: account.points, message: 'Canje exitoso' };
  }

  /**
   * Add bonus points (promotion, referral, etc.)
   */
  async addBonus(
    userId: string,
    points: number,
    description = 'Puntos de bonificación',
  ): Promise<{ total: number; tier: RewardTier; tierChanged: boolean }> {
    if (points <= 0) throw new Error('Puntos de bonificación deben ser positivos');

    const account = await this.getAccount(userId);
    const oldTier = account.tier;

    account.points += points;
    account.lifetimePoints += points;
    account.tier = this.calculateTier(account.lifetimePoints);
    account.lastEarnedAt = new Date().toISOString();

    const tierChanged = oldTier !== account.tier;

    try {
      const redis = getRedis();
      await redis.set(`${LOYALTY_PREFIX}${userId}`, JSON.stringify(account), { EX: LOYALTY_TTL });

      const txn: PointsTransaction = {
        id: `lpt_${randomBytes(8).toString('hex')}`,
        userId,
        type: 'bonus',
        points,
        description,
        reference: null,
        createdAt: new Date().toISOString(),
      };
      await this.appendHistory(userId, txn);
    } catch (err) {
      log.warn('Failed to save bonus points', { userId, error: (err as Error).message });
    }

    return { total: account.points, tier: account.tier, tierChanged };
  }

  /**
   * Get points transaction history for a user.
   */
  async getHistory(userId: string, limit = 20): Promise<PointsTransaction[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${HISTORY_PREFIX}${userId}`);
      if (!raw) return [];
      const all: PointsTransaction[] = JSON.parse(raw);
      return all.slice(-limit);
    } catch {
      return [];
    }
  }

  /**
   * Get tier info for a user.
   */
  async getTierInfo(userId: string): Promise<{
    current: RewardTier;
    multiplier: number;
    lifetimePoints: number;
    nextTier: RewardTier | null;
    pointsToNext: number;
  }> {
    const account = await this.getAccount(userId);
    const tiers: RewardTier[] = ['BRONCE', 'PLATA', 'ORO', 'PLATINO'];
    const currentIdx = tiers.indexOf(account.tier);
    const nextTier = currentIdx < tiers.length - 1 ? tiers[currentIdx + 1] : null;
    const pointsToNext = nextTier
      ? Math.max(0, TIER_THRESHOLDS[nextTier] - account.lifetimePoints)
      : 0;

    return {
      current: account.tier,
      multiplier: TIER_MULTIPLIERS[account.tier],
      lifetimePoints: account.lifetimePoints,
      nextTier,
      pointsToNext,
    };
  }

  /**
   * CRUD for reward catalog.
   */
  async addReward(item: Omit<RewardItem, 'id' | 'active'>): Promise<RewardItem> {
    if (!item.name || item.name.length > 100) throw new Error('Nombre inválido');
    if (item.pointsCost < 1) throw new Error('Costo en puntos debe ser >= 1');

    const reward: RewardItem = {
      id: `rwd_${randomBytes(8).toString('hex')}`,
      ...item,
      active: true,
    };

    try {
      const redis = getRedis();
      const raw = await redis.get(REWARDS_KEY);
      const rewards: RewardItem[] = raw ? JSON.parse(raw) : [];
      rewards.push(reward);
      await redis.set(REWARDS_KEY, JSON.stringify(rewards), { EX: LOYALTY_TTL });
    } catch (err) {
      log.warn('Failed to save reward', { error: (err as Error).message });
    }

    return reward;
  }

  async getRewards(): Promise<RewardItem[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(REWARDS_KEY);
      if (!raw) return [];
      return (JSON.parse(raw) as RewardItem[]).filter((r) => r.active);
    } catch {
      return [];
    }
  }

  async deactivateReward(rewardId: string): Promise<boolean> {
    try {
      const redis = getRedis();
      const raw = await redis.get(REWARDS_KEY);
      if (!raw) return false;
      const rewards: RewardItem[] = JSON.parse(raw);
      const reward = rewards.find((r) => r.id === rewardId);
      if (!reward) return false;
      reward.active = false;
      await redis.set(REWARDS_KEY, JSON.stringify(rewards), { EX: LOYALTY_TTL });
      return true;
    } catch {
      return false;
    }
  }

  // ─── Helpers ────────────────────────────────────────────

  calculateTier(lifetimePoints: number): RewardTier {
    if (lifetimePoints >= TIER_THRESHOLDS.PLATINO) return 'PLATINO';
    if (lifetimePoints >= TIER_THRESHOLDS.ORO) return 'ORO';
    if (lifetimePoints >= TIER_THRESHOLDS.PLATA) return 'PLATA';
    return 'BRONCE';
  }

  private async appendHistory(userId: string, txn: PointsTransaction): Promise<void> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${HISTORY_PREFIX}${userId}`);
      const history: PointsTransaction[] = raw ? JSON.parse(raw) : [];
      history.push(txn);
      // Keep last 100
      const trimmed = history.slice(-100);
      await redis.set(`${HISTORY_PREFIX}${userId}`, JSON.stringify(trimmed), { EX: LOYALTY_TTL });
    } catch {
      // Silent
    }
  }
}

export const loyalty = new LoyaltyService();
