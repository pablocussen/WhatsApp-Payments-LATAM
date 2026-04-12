import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('loyalty-program');
const LP_PREFIX = 'loyprog:';
const LP_TTL = 365 * 24 * 60 * 60;

export type RewardType = 'POINTS_PER_PURCHASE' | 'POINTS_PER_VISIT' | 'STAMP_CARD' | 'CASHBACK';

export interface LoyaltyProgram {
  id: string;
  merchantId: string;
  name: string;
  type: RewardType;
  pointsPerCLP: number;
  cashbackPercent: number;
  minRedeemPoints: number;
  pointToValueRate: number;
  active: boolean;
  enrolledCount: number;
  createdAt: string;
}

export interface CustomerLoyalty {
  customerId: string;
  programId: string;
  points: number;
  totalEarned: number;
  totalRedeemed: number;
  enrolledAt: string;
}

export class MerchantLoyaltyProgramService {
  async createProgram(input: {
    merchantId: string; name: string; type: RewardType;
    pointsPerCLP?: number; cashbackPercent?: number;
    minRedeemPoints?: number; pointToValueRate?: number;
  }): Promise<LoyaltyProgram> {
    if (!input.name) throw new Error('Nombre requerido.');

    const program: LoyaltyProgram = {
      id: 'loy_' + Date.now().toString(36),
      merchantId: input.merchantId,
      name: input.name,
      type: input.type,
      pointsPerCLP: input.pointsPerCLP ?? 0.01,
      cashbackPercent: input.cashbackPercent ?? 1,
      minRedeemPoints: input.minRedeemPoints ?? 100,
      pointToValueRate: input.pointToValueRate ?? 1,
      active: true,
      enrolledCount: 0,
      createdAt: new Date().toISOString(),
    };
    try { const redis = getRedis(); await redis.set(LP_PREFIX + program.id, JSON.stringify(program), { EX: LP_TTL }); }
    catch (err) { log.warn('Failed to save program', { error: (err as Error).message }); }
    return program;
  }

  async enrollCustomer(programId: string, customerId: string): Promise<CustomerLoyalty> {
    const enrollment: CustomerLoyalty = {
      customerId, programId,
      points: 0, totalEarned: 0, totalRedeemed: 0,
      enrolledAt: new Date().toISOString(),
    };
    try { const redis = getRedis(); await redis.set(LP_PREFIX + 'cust:' + programId + ':' + customerId, JSON.stringify(enrollment), { EX: LP_TTL }); }
    catch { /* ignore */ }
    return enrollment;
  }

  async earnPoints(programId: string, customerId: string, purchaseAmount: number): Promise<CustomerLoyalty | null> {
    const program = await this.getProgram(programId);
    const enrollment = await this.getEnrollment(programId, customerId);
    if (!program || !enrollment) return null;

    const points = Math.round(purchaseAmount * program.pointsPerCLP);
    enrollment.points += points;
    enrollment.totalEarned += points;
    try { const redis = getRedis(); await redis.set(LP_PREFIX + 'cust:' + programId + ':' + customerId, JSON.stringify(enrollment), { EX: LP_TTL }); }
    catch { return null; }
    return enrollment;
  }

  async redeemPoints(programId: string, customerId: string, points: number): Promise<{ success: boolean; valueGiven: number; error?: string }> {
    const program = await this.getProgram(programId);
    const enrollment = await this.getEnrollment(programId, customerId);
    if (!program || !enrollment) return { success: false, valueGiven: 0, error: 'No encontrado.' };
    if (points < program.minRedeemPoints) return { success: false, valueGiven: 0, error: 'Minimo ' + program.minRedeemPoints + ' puntos.' };
    if (enrollment.points < points) return { success: false, valueGiven: 0, error: 'Puntos insuficientes.' };

    enrollment.points -= points;
    enrollment.totalRedeemed += points;
    const valueGiven = points * program.pointToValueRate;
    try { const redis = getRedis(); await redis.set(LP_PREFIX + 'cust:' + programId + ':' + customerId, JSON.stringify(enrollment), { EX: LP_TTL }); }
    catch { return { success: false, valueGiven: 0 }; }
    return { success: true, valueGiven };
  }

  async getProgram(id: string): Promise<LoyaltyProgram | null> {
    try { const redis = getRedis(); const raw = await redis.get(LP_PREFIX + id); return raw ? JSON.parse(raw) as LoyaltyProgram : null; }
    catch { return null; }
  }

  async getEnrollment(programId: string, customerId: string): Promise<CustomerLoyalty | null> {
    try { const redis = getRedis(); const raw = await redis.get(LP_PREFIX + 'cust:' + programId + ':' + customerId); return raw ? JSON.parse(raw) as CustomerLoyalty : null; }
    catch { return null; }
  }
}

export const merchantLoyaltyProgram = new MerchantLoyaltyProgramService();
