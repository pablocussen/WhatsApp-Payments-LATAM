import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-prefs');

// ─── Types ──────────────────────────────────────────────

export type Language = 'es' | 'en';
export type ReceiptFormat = 'short' | 'detailed';

export interface UserPreferences {
  language: Language;
  receiptFormat: ReceiptFormat;
  confirmBeforePay: boolean;        // require PIN on every payment (default true)
  showBalanceOnGreet: boolean;      // show balance when user says hi
  defaultTipPercent: number;        // 0-20, default 0
  nickName: string | null;          // display name override
}

const PREFS_PREFIX = 'prefs:user:';
const PREFS_TTL = 365 * 24 * 60 * 60;

const DEFAULT_PREFS: UserPreferences = {
  language: 'es',
  receiptFormat: 'short',
  confirmBeforePay: true,
  showBalanceOnGreet: false,
  defaultTipPercent: 0,
  nickName: null,
};

// ─── Service ────────────────────────────────────────────

export class UserPrefsService {
  /**
   * Get user preferences (merged with defaults).
   */
  async getPrefs(userId: string): Promise<UserPreferences> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${PREFS_PREFIX}${userId}`);
      if (!raw) return { ...DEFAULT_PREFS };
      return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_PREFS };
    }
  }

  /**
   * Update one or more preferences.
   */
  async setPrefs(userId: string, updates: Partial<UserPreferences>): Promise<UserPreferences> {
    // Validate
    if (updates.language != null && !['es', 'en'].includes(updates.language)) {
      throw new Error('Idioma no soportado');
    }
    if (updates.receiptFormat != null && !['short', 'detailed'].includes(updates.receiptFormat)) {
      throw new Error('Formato de recibo inválido');
    }
    if (updates.defaultTipPercent != null && (updates.defaultTipPercent < 0 || updates.defaultTipPercent > 20)) {
      throw new Error('Propina debe estar entre 0% y 20%');
    }
    if (updates.nickName != null && updates.nickName.length > 30) {
      throw new Error('Nombre debe tener máximo 30 caracteres');
    }

    const current = await this.getPrefs(userId);
    const merged = { ...current, ...updates };

    try {
      const redis = getRedis();
      await redis.set(`${PREFS_PREFIX}${userId}`, JSON.stringify(merged), { EX: PREFS_TTL });
    } catch (err) {
      log.warn('Failed to save user prefs', { userId, error: (err as Error).message });
    }

    return merged;
  }

  /**
   * Reset all preferences to defaults.
   */
  async resetPrefs(userId: string): Promise<UserPreferences> {
    try {
      const redis = getRedis();
      await redis.del(`${PREFS_PREFIX}${userId}`);
    } catch (err) {
      log.warn('Failed to reset user prefs', { userId, error: (err as Error).message });
    }
    return { ...DEFAULT_PREFS };
  }

  /**
   * Get a single preference value.
   */
  async getPref<K extends keyof UserPreferences>(userId: string, key: K): Promise<UserPreferences[K]> {
    const prefs = await this.getPrefs(userId);
    return prefs[key];
  }
}

export const userPrefs = new UserPrefsService();
