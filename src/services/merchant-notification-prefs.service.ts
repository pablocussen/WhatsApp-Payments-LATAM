import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-notif-prefs');

const PREFS_PREFIX = 'mnotif:';
const PREFS_TTL = 365 * 24 * 60 * 60;

export type NotifChannel = 'WHATSAPP' | 'EMAIL' | 'WEBHOOK';
export type NotifEvent = 'PAYMENT_RECEIVED' | 'PAYOUT_COMPLETED' | 'PAYOUT_FAILED' | 'DISPUTE_OPENED' | 'DAILY_SUMMARY' | 'LOW_BALANCE';

export interface MerchantNotifPrefs {
  merchantId: string;
  channels: Record<NotifEvent, NotifChannel[]>;
  quietHoursStart: number | null; // hour 0-23
  quietHoursEnd: number | null;
  timezone: string;
  emailAddress: string | null;
  webhookUrl: string | null;
  enabled: boolean;
  updatedAt: string;
}

const DEFAULT_CHANNELS: Record<NotifEvent, NotifChannel[]> = {
  PAYMENT_RECEIVED: ['WHATSAPP'],
  PAYOUT_COMPLETED: ['WHATSAPP', 'EMAIL'],
  PAYOUT_FAILED: ['WHATSAPP', 'EMAIL'],
  DISPUTE_OPENED: ['WHATSAPP', 'EMAIL'],
  DAILY_SUMMARY: ['EMAIL'],
  LOW_BALANCE: ['WHATSAPP'],
};

export class MerchantNotifPrefsService {
  async getPrefs(merchantId: string): Promise<MerchantNotifPrefs> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${PREFS_PREFIX}${merchantId}`);
      if (raw) return JSON.parse(raw) as MerchantNotifPrefs;
    } catch { /* default */ }

    return {
      merchantId,
      channels: { ...DEFAULT_CHANNELS },
      quietHoursStart: null,
      quietHoursEnd: null,
      timezone: 'America/Santiago',
      emailAddress: null,
      webhookUrl: null,
      enabled: true,
      updatedAt: new Date().toISOString(),
    };
  }

  async updatePrefs(merchantId: string, updates: Partial<Omit<MerchantNotifPrefs, 'merchantId' | 'updatedAt'>>): Promise<MerchantNotifPrefs> {
    const prefs = await this.getPrefs(merchantId);

    if (updates.channels) prefs.channels = updates.channels;
    if (updates.quietHoursStart !== undefined) prefs.quietHoursStart = updates.quietHoursStart;
    if (updates.quietHoursEnd !== undefined) prefs.quietHoursEnd = updates.quietHoursEnd;
    if (updates.timezone) prefs.timezone = updates.timezone;
    if (updates.emailAddress !== undefined) prefs.emailAddress = updates.emailAddress;
    if (updates.webhookUrl !== undefined) prefs.webhookUrl = updates.webhookUrl;
    if (updates.enabled !== undefined) prefs.enabled = updates.enabled;
    prefs.updatedAt = new Date().toISOString();

    try {
      const redis = getRedis();
      await redis.set(`${PREFS_PREFIX}${merchantId}`, JSON.stringify(prefs), { EX: PREFS_TTL });
    } catch (err) {
      log.warn('Failed to save merchant notif prefs', { merchantId, error: (err as Error).message });
    }

    log.info('Merchant notif prefs updated', { merchantId });
    return prefs;
  }

  async setChannelForEvent(merchantId: string, event: NotifEvent, channels: NotifChannel[]): Promise<MerchantNotifPrefs> {
    if (!DEFAULT_CHANNELS[event]) throw new Error('Evento invalido.');
    const valid: NotifChannel[] = ['WHATSAPP', 'EMAIL', 'WEBHOOK'];
    for (const ch of channels) {
      if (!valid.includes(ch)) throw new Error(`Canal invalido: ${ch}`);
    }
    const prefs = await this.getPrefs(merchantId);
    prefs.channels[event] = channels;
    prefs.updatedAt = new Date().toISOString();

    try {
      const redis = getRedis();
      await redis.set(`${PREFS_PREFIX}${merchantId}`, JSON.stringify(prefs), { EX: PREFS_TTL });
    } catch (err) {
      log.warn('Failed to save channel pref', { merchantId, error: (err as Error).message });
    }

    return prefs;
  }

  shouldNotify(prefs: MerchantNotifPrefs, event: NotifEvent): { notify: boolean; channels: NotifChannel[] } {
    if (!prefs.enabled) return { notify: false, channels: [] };

    const channels = prefs.channels[event] ?? [];
    if (channels.length === 0) return { notify: false, channels: [] };

    // Check quiet hours
    if (prefs.quietHoursStart !== null && prefs.quietHoursEnd !== null) {
      const now = new Date();
      const hour = now.getHours(); // simplified — should use timezone
      if (prefs.quietHoursStart <= prefs.quietHoursEnd) {
        if (hour >= prefs.quietHoursStart && hour < prefs.quietHoursEnd) {
          // In quiet hours — only allow EMAIL (async)
          return { notify: true, channels: channels.filter(c => c === 'EMAIL' || c === 'WEBHOOK') };
        }
      } else {
        // Overnight quiet hours (e.g. 22-07)
        if (hour >= prefs.quietHoursStart || hour < prefs.quietHoursEnd) {
          return { notify: true, channels: channels.filter(c => c === 'EMAIL' || c === 'WEBHOOK') };
        }
      }
    }

    return { notify: true, channels };
  }

  getEventLabel(event: NotifEvent): string {
    const labels: Record<NotifEvent, string> = {
      PAYMENT_RECEIVED: 'Pago recibido',
      PAYOUT_COMPLETED: 'Liquidacion completada',
      PAYOUT_FAILED: 'Liquidacion fallida',
      DISPUTE_OPENED: 'Disputa abierta',
      DAILY_SUMMARY: 'Resumen diario',
      LOW_BALANCE: 'Saldo bajo',
    };
    return labels[event] ?? event;
  }
}

export const merchantNotifPrefs = new MerchantNotifPrefsService();
