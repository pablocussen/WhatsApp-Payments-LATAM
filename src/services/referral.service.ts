import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { randomBytes } from 'crypto';

const log = createLogger('referral');

// ─── Types ──────────────────────────────────────────────

export type ReferralStatus = 'pending' | 'completed' | 'expired' | 'rewarded';

export interface ReferralCode {
  code: string;
  userId: string;
  createdAt: string;
  usageCount: number;
  maxUses: number;
  rewardPerReferral: number;   // CLP bonus for referrer
  rewardForReferred: number;   // CLP bonus for new user
  active: boolean;
}

export interface Referral {
  id: string;
  code: string;
  referrerId: string;
  referredId: string;
  status: ReferralStatus;
  referrerReward: number;
  referredReward: number;
  createdAt: string;
  completedAt: string | null;
}

export interface ReferralStats {
  totalReferrals: number;
  completedReferrals: number;
  pendingReferrals: number;
  totalEarned: number;
}

const CODE_PREFIX = 'referral:code:';
const USER_CODE_PREFIX = 'referral:user:';
const REFERRAL_PREFIX = 'referral:entry:';
const USER_REFERRALS = 'referral:list:';
const REFERRAL_TTL = 365 * 24 * 60 * 60;

const DEFAULT_REWARD_REFERRER = 1000;  // $1,000 CLP
const DEFAULT_REWARD_REFERRED = 500;   // $500 CLP
const DEFAULT_MAX_USES = 50;

// ─── Service ────────────────────────────────────────────

export class ReferralService {
  /**
   * Generate a referral code for a user.
   */
  async generateCode(userId: string): Promise<ReferralCode> {
    // Check if user already has a code
    try {
      const redis = getRedis();
      const existingCode = await redis.get(`${USER_CODE_PREFIX}${userId}`);
      if (existingCode) {
        const existing = await redis.get(`${CODE_PREFIX}${existingCode}`);
        if (existing) return JSON.parse(existing);
      }
    } catch {
      // Fall through
    }

    const code = `WP${randomBytes(4).toString('hex').toUpperCase()}`;
    const referralCode: ReferralCode = {
      code,
      userId,
      createdAt: new Date().toISOString(),
      usageCount: 0,
      maxUses: DEFAULT_MAX_USES,
      rewardPerReferral: DEFAULT_REWARD_REFERRER,
      rewardForReferred: DEFAULT_REWARD_REFERRED,
      active: true,
    };

    try {
      const redis = getRedis();
      await redis.set(`${CODE_PREFIX}${code}`, JSON.stringify(referralCode), { EX: REFERRAL_TTL });
      await redis.set(`${USER_CODE_PREFIX}${userId}`, code, { EX: REFERRAL_TTL });
      log.info('Referral code generated', { userId, code });
    } catch (err) {
      log.warn('Failed to save referral code', { userId, error: (err as Error).message });
    }

    return referralCode;
  }

  /**
   * Get a referral code by code string.
   */
  async getCode(code: string): Promise<ReferralCode | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${CODE_PREFIX}${code}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * Get a user's referral code.
   */
  async getUserCode(userId: string): Promise<ReferralCode | null> {
    try {
      const redis = getRedis();
      const code = await redis.get(`${USER_CODE_PREFIX}${userId}`);
      if (!code) return null;
      const raw = await redis.get(`${CODE_PREFIX}${code}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * Apply a referral code for a new user.
   */
  async applyCode(
    code: string,
    referredId: string,
  ): Promise<{ success: boolean; message: string; referral?: Referral }> {
    const referralCode = await this.getCode(code);

    if (!referralCode) {
      return { success: false, message: 'Código de referido no encontrado' };
    }
    if (!referralCode.active) {
      return { success: false, message: 'Código de referido inactivo' };
    }
    if (referralCode.usageCount >= referralCode.maxUses) {
      return { success: false, message: 'Código ha alcanzado el máximo de usos' };
    }
    if (referralCode.userId === referredId) {
      return { success: false, message: 'No puedes usar tu propio código de referido' };
    }

    // Check if user already used a referral
    const existingRef = await this.getUserReferredBy(referredId);
    if (existingRef) {
      return { success: false, message: 'Ya has usado un código de referido' };
    }

    const referral: Referral = {
      id: `ref_${randomBytes(8).toString('hex')}`,
      code,
      referrerId: referralCode.userId,
      referredId,
      status: 'pending',
      referrerReward: referralCode.rewardPerReferral,
      referredReward: referralCode.rewardForReferred,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    try {
      const redis = getRedis();

      // Save referral
      await redis.set(`${REFERRAL_PREFIX}${referral.id}`, JSON.stringify(referral), { EX: REFERRAL_TTL });

      // Track who referred whom
      await redis.set(`referral:referred-by:${referredId}`, referral.id, { EX: REFERRAL_TTL });

      // Add to referrer's list
      const listKey = `${USER_REFERRALS}${referralCode.userId}`;
      const listRaw = await redis.get(listKey);
      const list: string[] = listRaw ? JSON.parse(listRaw) : [];
      list.push(referral.id);
      await redis.set(listKey, JSON.stringify(list), { EX: REFERRAL_TTL });

      // Increment usage count
      referralCode.usageCount += 1;
      await redis.set(`${CODE_PREFIX}${code}`, JSON.stringify(referralCode), { EX: REFERRAL_TTL });

      log.info('Referral applied', { referralId: referral.id, referrerId: referralCode.userId, referredId });
    } catch (err) {
      log.warn('Failed to save referral', { error: (err as Error).message });
    }

    return { success: true, message: 'Código aplicado exitosamente', referral };
  }

  /**
   * Complete a referral (mark as completed and distribute rewards).
   */
  async completeReferral(referralId: string): Promise<Referral | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${REFERRAL_PREFIX}${referralId}`);
      if (!raw) return null;

      const referral: Referral = JSON.parse(raw);
      if (referral.status !== 'pending') return null;

      referral.status = 'completed';
      referral.completedAt = new Date().toISOString();

      await redis.set(`${REFERRAL_PREFIX}${referralId}`, JSON.stringify(referral), { EX: REFERRAL_TTL });
      log.info('Referral completed', { referralId, referrerId: referral.referrerId, referredId: referral.referredId });
      return referral;
    } catch {
      return null;
    }
  }

  /**
   * Get referrals made by a user.
   */
  async getUserReferrals(userId: string): Promise<Referral[]> {
    try {
      const redis = getRedis();
      const listRaw = await redis.get(`${USER_REFERRALS}${userId}`);
      if (!listRaw) return [];

      const ids: string[] = JSON.parse(listRaw);
      const referrals: Referral[] = [];

      for (const id of ids) {
        const raw = await redis.get(`${REFERRAL_PREFIX}${id}`);
        if (raw) referrals.push(JSON.parse(raw));
      }

      return referrals;
    } catch {
      return [];
    }
  }

  /**
   * Get referral stats for a user.
   */
  async getStats(userId: string): Promise<ReferralStats> {
    const referrals = await this.getUserReferrals(userId);
    const completed = referrals.filter((r) => r.status === 'completed');
    const pending = referrals.filter((r) => r.status === 'pending');

    return {
      totalReferrals: referrals.length,
      completedReferrals: completed.length,
      pendingReferrals: pending.length,
      totalEarned: completed.reduce((sum, r) => sum + r.referrerReward, 0),
    };
  }

  /**
   * Deactivate a referral code.
   */
  async deactivateCode(userId: string): Promise<boolean> {
    try {
      const redis = getRedis();
      const code = await redis.get(`${USER_CODE_PREFIX}${userId}`);
      if (!code) return false;

      const raw = await redis.get(`${CODE_PREFIX}${code}`);
      if (!raw) return false;

      const referralCode: ReferralCode = JSON.parse(raw);
      referralCode.active = false;
      await redis.set(`${CODE_PREFIX}${code}`, JSON.stringify(referralCode), { EX: REFERRAL_TTL });
      return true;
    } catch {
      return false;
    }
  }

  // ─── Helpers ────────────────────────────────────────────

  private async getUserReferredBy(userId: string): Promise<string | null> {
    try {
      const redis = getRedis();
      return await redis.get(`referral:referred-by:${userId}`);
    } catch {
      return null;
    }
  }
}

export const referral = new ReferralService();
