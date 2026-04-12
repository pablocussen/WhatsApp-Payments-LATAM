import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('crypto-wallet');
const CW_PREFIX = 'cwallet:';
const CW_TTL = 365 * 24 * 60 * 60;

export type CryptoCurrency = 'BTC' | 'USDT' | 'USDC' | 'ETH';

export interface CryptoWallet {
  userId: string;
  currency: CryptoCurrency;
  address: string;
  balance: number;
  totalDeposited: number;
  totalWithdrawn: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export class UserCryptoWalletService {
  async createWallet(userId: string, currency: CryptoCurrency): Promise<CryptoWallet> {
    const validCurrencies: CryptoCurrency[] = ['BTC', 'USDT', 'USDC', 'ETH'];
    if (!validCurrencies.includes(currency)) throw new Error('Moneda cripto no soportada.');
    const existing = await this.getWallet(userId, currency);
    if (existing) throw new Error('Ya existe una wallet para esta moneda.');

    const wallet: CryptoWallet = {
      userId, currency,
      address: this.generateAddress(currency),
      balance: 0, totalDeposited: 0, totalWithdrawn: 0,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      const redis = getRedis();
      await redis.set(`${CW_PREFIX}${userId}:${currency}`, JSON.stringify(wallet), { EX: CW_TTL });
    } catch (err) { log.warn('Failed to create wallet', { error: (err as Error).message }); }
    log.info('Crypto wallet created', { userId, currency });
    return wallet;
  }

  async getWallet(userId: string, currency: CryptoCurrency): Promise<CryptoWallet | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${CW_PREFIX}${userId}:${currency}`);
      return raw ? JSON.parse(raw) as CryptoWallet : null;
    } catch { return null; }
  }

  async deposit(userId: string, currency: CryptoCurrency, amount: number): Promise<boolean> {
    if (amount <= 0) throw new Error('Monto debe ser positivo.');
    const wallet = await this.getWallet(userId, currency);
    if (!wallet || !wallet.active) return false;
    wallet.balance += amount;
    wallet.totalDeposited += amount;
    wallet.updatedAt = new Date().toISOString();
    try {
      const redis = getRedis();
      await redis.set(`${CW_PREFIX}${userId}:${currency}`, JSON.stringify(wallet), { EX: CW_TTL });
    } catch { return false; }
    return true;
  }

  async withdraw(userId: string, currency: CryptoCurrency, amount: number): Promise<boolean> {
    if (amount <= 0) throw new Error('Monto debe ser positivo.');
    const wallet = await this.getWallet(userId, currency);
    if (!wallet || !wallet.active) return false;
    if (wallet.balance < amount) throw new Error('Saldo insuficiente.');
    wallet.balance -= amount;
    wallet.totalWithdrawn += amount;
    wallet.updatedAt = new Date().toISOString();
    try {
      const redis = getRedis();
      await redis.set(`${CW_PREFIX}${userId}:${currency}`, JSON.stringify(wallet), { EX: CW_TTL });
    } catch { return false; }
    return true;
  }

  private generateAddress(currency: CryptoCurrency): string {
    const prefix = currency === 'BTC' ? 'bc1' : '0x';
    const chars = currency === 'BTC' ? 'qwertyuiopasdfghjklzxcvbnm0123456789' : '0123456789abcdef';
    const len = currency === 'BTC' ? 39 : 40;
    return prefix + Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }
}

export const userCryptoWallet = new UserCryptoWalletService();
