import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-settings');

const SETTINGS_PREFIX = 'usettings:';
const SETTINGS_TTL = 365 * 24 * 60 * 60;

export type DisplayCurrency = 'CLP' | 'USD' | 'UF';
export type Language = 'es' | 'en';
export type NotifMode = 'ALL' | 'IMPORTANT' | 'NONE';
export type Theme = 'LIGHT' | 'DARK' | 'AUTO';

export interface UserSettings {
  userId: string;
  language: Language;
  displayCurrency: DisplayCurrency;
  notifMode: NotifMode;
  theme: Theme;
  showBalance: boolean;
  confirmBeforeSend: boolean;
  dailySummary: boolean;
  twoFactorEnabled: boolean;
  timezone: string;
  updatedAt: string;
}

const DEFAULTS: Omit<UserSettings, 'userId' | 'updatedAt'> = {
  language: 'es',
  displayCurrency: 'CLP',
  notifMode: 'ALL',
  theme: 'AUTO',
  showBalance: true,
  confirmBeforeSend: true,
  dailySummary: false,
  twoFactorEnabled: false,
  timezone: 'America/Santiago',
};

export class UserSettingsService {
  async getSettings(userId: string): Promise<UserSettings> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${SETTINGS_PREFIX}${userId}`);
      if (raw) return JSON.parse(raw) as UserSettings;
    } catch { /* defaults */ }

    return { userId, ...DEFAULTS, updatedAt: new Date().toISOString() };
  }

  async updateSettings(userId: string, updates: Partial<Omit<UserSettings, 'userId' | 'updatedAt'>>): Promise<UserSettings> {
    const settings = await this.getSettings(userId);

    if (updates.language !== undefined) {
      if (!['es', 'en'].includes(updates.language)) throw new Error('Idioma inválido. Use es o en.');
      settings.language = updates.language;
    }
    if (updates.displayCurrency !== undefined) {
      if (!['CLP', 'USD', 'UF'].includes(updates.displayCurrency)) throw new Error('Moneda inválida.');
      settings.displayCurrency = updates.displayCurrency;
    }
    if (updates.notifMode !== undefined) settings.notifMode = updates.notifMode;
    if (updates.theme !== undefined) settings.theme = updates.theme;
    if (updates.showBalance !== undefined) settings.showBalance = updates.showBalance;
    if (updates.confirmBeforeSend !== undefined) settings.confirmBeforeSend = updates.confirmBeforeSend;
    if (updates.dailySummary !== undefined) settings.dailySummary = updates.dailySummary;
    if (updates.twoFactorEnabled !== undefined) settings.twoFactorEnabled = updates.twoFactorEnabled;
    if (updates.timezone !== undefined) settings.timezone = updates.timezone;
    settings.updatedAt = new Date().toISOString();

    try {
      const redis = getRedis();
      await redis.set(`${SETTINGS_PREFIX}${userId}`, JSON.stringify(settings), { EX: SETTINGS_TTL });
    } catch (err) {
      log.warn('Failed to save settings', { userId, error: (err as Error).message });
    }

    log.info('Settings updated', { userId });
    return settings;
  }

  async resetToDefaults(userId: string): Promise<UserSettings> {
    const settings: UserSettings = { userId, ...DEFAULTS, updatedAt: new Date().toISOString() };
    try {
      const redis = getRedis();
      await redis.set(`${SETTINGS_PREFIX}${userId}`, JSON.stringify(settings), { EX: SETTINGS_TTL });
    } catch (err) {
      log.warn('Failed to reset settings', { userId, error: (err as Error).message });
    }
    return settings;
  }

  getSettingsSummary(settings: UserSettings): string {
    return [
      `Idioma: ${settings.language === 'es' ? 'Español' : 'English'}`,
      `Moneda: ${settings.displayCurrency}`,
      `Notificaciones: ${settings.notifMode}`,
      `Confirmar envío: ${settings.confirmBeforeSend ? 'Sí' : 'No'}`,
      `Resumen diario: ${settings.dailySummary ? 'Sí' : 'No'}`,
      `2FA: ${settings.twoFactorEnabled ? 'Activo' : 'Inactivo'}`,
    ].join(' | ');
  }
}

export const userSettings = new UserSettingsService();
