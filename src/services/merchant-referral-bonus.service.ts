import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-referral-bonus');
const PREFIX = 'merchant:ref-bonus:';
const TTL = 365 * 24 * 60 * 60;

export type BonusStatus = 'PENDING' | 'PAID' | 'CANCELLED';

export interface MerchantReferral {
  id: string;
  referrerId: string;
  referredId: string;
  referredName: string;
  bonusAmount: number;
  status: BonusStatus;
  minTransactions: number;
  currentTransactions: number;
  createdAt: string;
  paidAt?: string;
}

export class MerchantReferralBonusService {
  private key(referrerId: string): string {
    return `${PREFIX}${referrerId}`;
  }

  async list(referrerId: string): Promise<MerchantReferral[]> {
    const raw = await getRedis().get(this.key(referrerId));
    return raw ? JSON.parse(raw) : [];
  }

  async create(input: {
    referrerId: string;
    referredId: string;
    referredName: string;
    bonusAmount?: number;
    minTransactions?: number;
  }): Promise<MerchantReferral> {
    const bonus = input.bonusAmount ?? 15000;
    if (bonus < 1000 || bonus > 100000) {
      throw new Error('Bonus debe estar entre $1.000 y $100.000');
    }
    const list = await this.list(input.referrerId);
    if (list.some(r => r.referredId === input.referredId)) {
      throw new Error('Comerciante ya referido');
    }
    const ref: MerchantReferral = {
      id: `mref_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      referrerId: input.referrerId,
      referredId: input.referredId,
      referredName: input.referredName,
      bonusAmount: bonus,
      status: 'PENDING',
      minTransactions: input.minTransactions ?? 10,
      currentTransactions: 0,
      createdAt: new Date().toISOString(),
    };
    list.push(ref);
    await getRedis().set(this.key(input.referrerId), JSON.stringify(list), { EX: TTL });
    log.info('merchant referral created', { id: ref.id });
    return ref;
  }

  async incrementTx(referrerId: string, referredId: string): Promise<MerchantReferral | null> {
    const list = await this.list(referrerId);
    const ref = list.find(r => r.referredId === referredId && r.status === 'PENDING');
    if (!ref) return null;
    ref.currentTransactions++;
    if (ref.currentTransactions >= ref.minTransactions) {
      ref.status = 'PAID';
      ref.paidAt = new Date().toISOString();
    }
    await getRedis().set(this.key(referrerId), JSON.stringify(list), { EX: TTL });
    return ref;
  }

  async cancel(referrerId: string, id: string): Promise<boolean> {
    const list = await this.list(referrerId);
    const ref = list.find(r => r.id === id);
    if (!ref || ref.status !== 'PENDING') return false;
    ref.status = 'CANCELLED';
    await getRedis().set(this.key(referrerId), JSON.stringify(list), { EX: TTL });
    return true;
  }

  async getTotalEarned(referrerId: string): Promise<number> {
    const list = await this.list(referrerId);
    return list.filter(r => r.status === 'PAID').reduce((s, r) => s + r.bonusAmount, 0);
  }

  async getPendingCount(referrerId: string): Promise<number> {
    const list = await this.list(referrerId);
    return list.filter(r => r.status === 'PENDING').length;
  }
}

export const merchantReferralBonus = new MerchantReferralBonusService();
