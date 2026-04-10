import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('referral-rewards');

const REF_PREFIX = 'refrew:';
const REF_TTL = 365 * 24 * 60 * 60;

const REWARD_AMOUNT = 2000; // $2.000 CLP per referral
const MAX_REWARDS = 50; // max 50 referrals rewarded
const REFERRAL_BONUS_REFEREE = 2000; // referee also gets $2.000

export interface ReferralReward {
  referrerId: string;
  refereeId: string;
  referrerReward: number;
  refereeReward: number;
  status: 'PENDING' | 'COMPLETED' | 'EXPIRED';
  createdAt: string;
  completedAt: string | null;
}

export interface ReferralStats {
  userId: string;
  referralCode: string;
  totalReferred: number;
  totalRewarded: number;
  totalEarned: number;
  pendingRewards: number;
}

export class ReferralRewardsService {
  /**
   * Generate referral code for a user.
   */
  generateCode(userId: string): string {
    return `WP-${userId.slice(-6).toUpperCase()}`;
  }

  /**
   * Record a referral when a new user signs up with a code.
   */
  async recordReferral(referrerId: string, refereeId: string): Promise<ReferralReward> {
    if (referrerId === refereeId) throw new Error('No puedes referirte a ti mismo.');

    const rewards = await this.getRewards(referrerId);
    if (rewards.filter(r => r.status === 'COMPLETED').length >= MAX_REWARDS) {
      throw new Error(`Maximo ${MAX_REWARDS} referidos con recompensa.`);
    }

    // Check duplicate
    if (rewards.some(r => r.refereeId === refereeId)) {
      throw new Error('Este usuario ya fue referido.');
    }

    const reward: ReferralReward = {
      referrerId,
      refereeId,
      referrerReward: REWARD_AMOUNT,
      refereeReward: REFERRAL_BONUS_REFEREE,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    rewards.push(reward);
    await this.saveRewards(referrerId, rewards);

    log.info('Referral recorded', { referrerId, refereeId });
    return reward;
  }

  /**
   * Complete a referral (when referee makes first transaction).
   */
  async completeReferral(referrerId: string, refereeId: string): Promise<ReferralReward | null> {
    const rewards = await this.getRewards(referrerId);
    const reward = rewards.find(r => r.refereeId === refereeId && r.status === 'PENDING');
    if (!reward) return null;

    reward.status = 'COMPLETED';
    reward.completedAt = new Date().toISOString();
    await this.saveRewards(referrerId, rewards);

    log.info('Referral completed', {
      referrerId, refereeId,
      referrerReward: reward.referrerReward,
      refereeReward: reward.refereeReward,
    });
    return reward;
  }

  /**
   * Get all rewards for a user (as referrer).
   */
  async getRewards(userId: string): Promise<ReferralReward[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${REF_PREFIX}${userId}`);
      return raw ? JSON.parse(raw) as ReferralReward[] : [];
    } catch {
      return [];
    }
  }

  /**
   * Get referral stats for a user.
   */
  async getStats(userId: string): Promise<ReferralStats> {
    const rewards = await this.getRewards(userId);
    const completed = rewards.filter(r => r.status === 'COMPLETED');
    const pending = rewards.filter(r => r.status === 'PENDING');

    return {
      userId,
      referralCode: this.generateCode(userId),
      totalReferred: rewards.length,
      totalRewarded: completed.length,
      totalEarned: completed.reduce((sum, r) => sum + r.referrerReward, 0),
      pendingRewards: pending.length,
    };
  }

  /**
   * Get formatted stats summary.
   */
  async getStatsSummary(userId: string): Promise<string> {
    const stats = await this.getStats(userId);
    return [
      `Codigo: ${stats.referralCode}`,
      `Referidos: ${stats.totalReferred}`,
      `Completados: ${stats.totalRewarded}`,
      `Ganado: ${formatCLP(stats.totalEarned)}`,
      `Pendientes: ${stats.pendingRewards}`,
    ].join(' | ');
  }

  private async saveRewards(userId: string, rewards: ReferralReward[]): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${REF_PREFIX}${userId}`, JSON.stringify(rewards), { EX: REF_TTL });
    } catch (err) {
      log.warn('Failed to save rewards', { userId, error: (err as Error).message });
    }
  }
}

export const referralRewards = new ReferralRewardsService();
