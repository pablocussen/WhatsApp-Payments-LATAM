import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('wallet-split');
const WS_PREFIX = 'walsplit:';
const WS_TTL = 365 * 24 * 60 * 60;

export interface WalletSubAccount {
  id: string;
  userId: string;
  name: string;
  emoji: string;
  balance: number;
  purpose: string;
  color: string;
  active: boolean;
  createdAt: string;
}

export class UserWalletSplitService {
  async createSubAccount(input: { userId: string; name: string; emoji: string; purpose: string; color: string; initialBalance?: number }): Promise<WalletSubAccount> {
    if (!input.name || input.name.length > 30) throw new Error('Nombre entre 1 y 30 caracteres.');
    const subs = await this.getSubAccounts(input.userId);
    if (subs.length >= 10) throw new Error('Maximo 10 sub-cuentas.');

    const sub: WalletSubAccount = {
      id: 'sub_' + Date.now().toString(36),
      userId: input.userId,
      name: input.name,
      emoji: input.emoji,
      balance: input.initialBalance ?? 0,
      purpose: input.purpose,
      color: input.color,
      active: true,
      createdAt: new Date().toISOString(),
    };
    subs.push(sub);
    await this.save(input.userId, subs);
    return sub;
  }

  async transfer(userId: string, fromId: string, toId: string, amount: number): Promise<{ success: boolean; error?: string }> {
    if (amount <= 0) return { success: false, error: 'Monto debe ser positivo.' };
    const subs = await this.getSubAccounts(userId);
    const from = subs.find(s => s.id === fromId);
    const to = subs.find(s => s.id === toId);
    if (!from || !to) return { success: false, error: 'Sub-cuenta no encontrada.' };
    if (from.balance < amount) return { success: false, error: 'Saldo insuficiente.' };

    from.balance -= amount;
    to.balance += amount;
    await this.save(userId, subs);
    return { success: true };
  }

  async deposit(userId: string, subId: string, amount: number): Promise<boolean> {
    const subs = await this.getSubAccounts(userId);
    const sub = subs.find(s => s.id === subId);
    if (!sub) return false;
    sub.balance += amount;
    await this.save(userId, subs);
    return true;
  }

  async withdraw(userId: string, subId: string, amount: number): Promise<boolean> {
    const subs = await this.getSubAccounts(userId);
    const sub = subs.find(s => s.id === subId);
    if (!sub || sub.balance < amount) return false;
    sub.balance -= amount;
    await this.save(userId, subs);
    return true;
  }

  async getSubAccounts(userId: string): Promise<WalletSubAccount[]> {
    try { const redis = getRedis(); const raw = await redis.get(WS_PREFIX + userId); return raw ? JSON.parse(raw) as WalletSubAccount[] : []; }
    catch { return []; }
  }

  async getTotalBalance(userId: string): Promise<number> {
    const subs = await this.getSubAccounts(userId);
    return subs.reduce((s, sub) => s + sub.balance, 0);
  }

  formatSubSummary(sub: WalletSubAccount): string {
    return sub.emoji + ' ' + sub.name + ': ' + formatCLP(sub.balance) + ' — ' + sub.purpose;
  }

  private async save(userId: string, subs: WalletSubAccount[]): Promise<void> {
    try { const redis = getRedis(); await redis.set(WS_PREFIX + userId, JSON.stringify(subs), { EX: WS_TTL }); }
    catch (err) { log.warn('Failed to save sub-accounts', { error: (err as Error).message }); }
  }
}

export const userWalletSplit = new UserWalletSplitService();
