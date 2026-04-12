import { createHash } from 'crypto';
import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('pin-history');
const PH_PREFIX = 'pinhist:';
const PH_TTL = 365 * 24 * 60 * 60;
const HISTORY_SIZE = 5;

export interface PINHistoryEntry {
  hashedPin: string;
  changedAt: string;
}

export class UserPINHistoryService {
  async recordPINChange(userId: string, pin: string): Promise<void> {
    const hash = this.hashPIN(pin);
    const history = await this.getHistory(userId);
    history.unshift({ hashedPin: hash, changedAt: new Date().toISOString() });
    const trimmed = history.slice(0, HISTORY_SIZE);
    try {
      const redis = getRedis();
      await redis.set(`${PH_PREFIX}${userId}`, JSON.stringify(trimmed), { EX: PH_TTL });
    } catch (err) {
      log.warn('Failed to save PIN history', { userId, error: (err as Error).message });
    }
  }

  async wasUsedBefore(userId: string, pin: string): Promise<boolean> {
    const hash = this.hashPIN(pin);
    const history = await this.getHistory(userId);
    return history.some(h => h.hashedPin === hash);
  }

  async getHistory(userId: string): Promise<PINHistoryEntry[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${PH_PREFIX}${userId}`);
      return raw ? JSON.parse(raw) as PINHistoryEntry[] : [];
    } catch {
      return [];
    }
  }

  async getLastChange(userId: string): Promise<string | null> {
    const history = await this.getHistory(userId);
    return history[0]?.changedAt ?? null;
  }

  async daysSinceLastChange(userId: string): Promise<number> {
    const last = await this.getLastChange(userId);
    if (!last) return Infinity;
    return Math.floor((Date.now() - new Date(last).getTime()) / (1000 * 60 * 60 * 24));
  }

  private hashPIN(pin: string): string {
    return createHash('sha256').update(pin + 'whatpay-salt').digest('hex');
  }
}

export const userPINHistory = new UserPINHistoryService();
