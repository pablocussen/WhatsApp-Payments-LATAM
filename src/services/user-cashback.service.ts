import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('cashback');
const CB_PREFIX = 'cashback:';
const CB_TTL = 365 * 24 * 60 * 60;

export interface CashbackRule {
  category: string;
  percent: number;
  maxPerTx: number;
}

export interface CashbackBalance {
  userId: string;
  available: number;
  totalEarned: number;
  totalRedeemed: number;
  lastEarnedAt: string | null;
}

const DEFAULT_RULES: CashbackRule[] = [
  { category: 'FOOD', percent: 2, maxPerTx: 5000 },
  { category: 'TRANSPORT', percent: 1, maxPerTx: 2000 },
  { category: 'BILLS', percent: 0.5, maxPerTx: 3000 },
  { category: 'SHOPPING', percent: 1.5, maxPerTx: 5000 },
];

export class UserCashbackService {
  calculateCashback(amount: number, category: string): number {
    const rule = DEFAULT_RULES.find(r => r.category === category);
    if (!rule) return 0;
    const raw = Math.round(amount * rule.percent / 100);
    return Math.min(raw, rule.maxPerTx);
  }

  async earnCashback(userId: string, amount: number): Promise<CashbackBalance> {
    if (amount <= 0) throw new Error('Monto debe ser positivo.');
    const balance = await this.getBalance(userId);
    balance.available += amount;
    balance.totalEarned += amount;
    balance.lastEarnedAt = new Date().toISOString();
    await this.save(balance);
    log.info('Cashback earned', { userId, amount });
    return balance;
  }

  async redeemCashback(userId: string, amount: number): Promise<{ success: boolean; error?: string }> {
    const balance = await this.getBalance(userId);
    if (amount <= 0) return { success: false, error: 'Monto debe ser positivo.' };
    if (balance.available < amount) return { success: false, error: 'Saldo cashback insuficiente.' };
    balance.available -= amount;
    balance.totalRedeemed += amount;
    await this.save(balance);
    return { success: true };
  }

  async getBalance(userId: string): Promise<CashbackBalance> {
    try {
      const redis = getRedis();
      const raw = await redis.get(CB_PREFIX + userId);
      if (raw) return JSON.parse(raw) as CashbackBalance;
    } catch { /* defaults */ }
    return { userId, available: 0, totalEarned: 0, totalRedeemed: 0, lastEarnedAt: null };
  }

  formatBalance(b: CashbackBalance): string {
    return 'Cashback disponible: ' + formatCLP(b.available) + ' (acumulado: ' + formatCLP(b.totalEarned) + ', canjeado: ' + formatCLP(b.totalRedeemed) + ')';
  }

  getRules(): CashbackRule[] {
    return [...DEFAULT_RULES];
  }

  private async save(balance: CashbackBalance): Promise<void> {
    try { const redis = getRedis(); await redis.set(CB_PREFIX + balance.userId, JSON.stringify(balance), { EX: CB_TTL }); }
    catch (err) { log.warn('Failed to save cashback', { error: (err as Error).message }); }
  }
}

export const userCashback = new UserCashbackService();
