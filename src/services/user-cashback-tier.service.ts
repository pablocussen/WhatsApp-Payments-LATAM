import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-cashback-tier');
const PREFIX = 'user:cashback-tier:';
const TTL = 365 * 24 * 60 * 60;

export type Tier = 'BRONZE' | 'SILVER' | 'GOLD' | 'PLATINUM';

export interface CashbackTier {
  userId: string;
  tier: Tier;
  monthlySpend: number;
  cashbackRate: number;
  totalEarned: number;
  nextTierAt: number;
  updatedAt: string;
}

const TIERS: { tier: Tier; min: number; rate: number }[] = [
  { tier: 'BRONZE', min: 0, rate: 0.005 },
  { tier: 'SILVER', min: 100000, rate: 0.010 },
  { tier: 'GOLD', min: 500000, rate: 0.015 },
  { tier: 'PLATINUM', min: 2000000, rate: 0.025 },
];

export class UserCashbackTierService {
  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  private computeTier(monthlySpend: number): { tier: Tier; rate: number; nextTierAt: number } {
    let current = TIERS[0];
    for (const t of TIERS) {
      if (monthlySpend >= t.min) current = t;
    }
    const next = TIERS.find(t => t.min > monthlySpend);
    return { tier: current.tier, rate: current.rate, nextTierAt: next ? next.min : 0 };
  }

  async get(userId: string): Promise<CashbackTier> {
    const raw = await getRedis().get(this.key(userId));
    if (raw) return JSON.parse(raw);
    return {
      userId,
      tier: 'BRONZE',
      monthlySpend: 0,
      cashbackRate: 0.005,
      totalEarned: 0,
      nextTierAt: 100000,
      updatedAt: new Date().toISOString(),
    };
  }

  async recordSpend(userId: string, amount: number): Promise<CashbackTier> {
    if (amount <= 0) throw new Error('Monto debe ser positivo');
    const current = await this.get(userId);
    const newSpend = current.monthlySpend + amount;
    const computed = this.computeTier(newSpend);
    const earned = Math.floor(amount * computed.rate);
    const updated: CashbackTier = {
      userId,
      tier: computed.tier,
      monthlySpend: newSpend,
      cashbackRate: computed.rate,
      totalEarned: current.totalEarned + earned,
      nextTierAt: computed.nextTierAt,
      updatedAt: new Date().toISOString(),
    };
    await getRedis().set(this.key(userId), JSON.stringify(updated), { EX: TTL });
    log.info('spend recorded', { userId, tier: updated.tier });
    return updated;
  }

  async resetMonthly(userId: string): Promise<CashbackTier> {
    const current = await this.get(userId);
    const updated: CashbackTier = {
      ...current,
      monthlySpend: 0,
      tier: 'BRONZE',
      cashbackRate: 0.005,
      nextTierAt: 100000,
      updatedAt: new Date().toISOString(),
    };
    await getRedis().set(this.key(userId), JSON.stringify(updated), { EX: TTL });
    return updated;
  }

  formatTierInfo(t: CashbackTier): string {
    const remaining = t.nextTierAt > 0 ? t.nextTierAt - t.monthlySpend : 0;
    const pct = (t.cashbackRate * 100).toFixed(1);
    const lines = [
      `Tier: ${t.tier}`,
      `Cashback: ${pct}%`,
      `Gasto mensual: $${t.monthlySpend.toLocaleString('es-CL')}`,
      `Total ganado: $${t.totalEarned.toLocaleString('es-CL')}`,
    ];
    if (remaining > 0) {
      lines.push(`Faltan $${remaining.toLocaleString('es-CL')} para subir de tier`);
    } else {
      lines.push('Tier maximo alcanzado');
    }
    return lines.join('\n');
  }
}

export const userCashbackTier = new UserCashbackTierService();
