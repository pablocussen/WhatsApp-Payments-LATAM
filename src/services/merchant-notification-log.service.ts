import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('notif-log');
const NL_PREFIX = 'mnotiflog:';
const NL_TTL = 90 * 24 * 60 * 60;
const MAX_LOGS = 200;

export interface NotificationLog {
  id: string;
  merchantId: string;
  channel: 'WHATSAPP' | 'EMAIL' | 'WEBHOOK';
  event: string;
  recipient: string;
  status: 'SENT' | 'DELIVERED' | 'FAILED' | 'BOUNCED';
  errorMessage: string | null;
  sentAt: string;
}

export class MerchantNotificationLogService {
  async logNotification(input: Omit<NotificationLog, 'id' | 'sentAt'>): Promise<NotificationLog> {
    const entry: NotificationLog = { ...input, id: `nlog_${Date.now().toString(36)}`, sentAt: new Date().toISOString() };
    try {
      const redis = getRedis();
      await redis.lPush(`${NL_PREFIX}${input.merchantId}`, JSON.stringify(entry));
      await redis.lTrim(`${NL_PREFIX}${input.merchantId}`, 0, MAX_LOGS - 1);
      await redis.expire(`${NL_PREFIX}${input.merchantId}`, NL_TTL);
    } catch (err) { log.warn('Failed to log notification', { error: (err as Error).message }); }
    return entry;
  }

  async getLogs(merchantId: string, limit = 20): Promise<NotificationLog[]> {
    try {
      const redis = getRedis();
      const raw = await redis.lRange(`${NL_PREFIX}${merchantId}`, 0, limit - 1);
      return raw.map(r => JSON.parse(r) as NotificationLog);
    } catch { return []; }
  }

  async getFailedCount(merchantId: string): Promise<number> {
    const logs = await this.getLogs(merchantId, MAX_LOGS);
    return logs.filter(l => l.status === 'FAILED' || l.status === 'BOUNCED').length;
  }

  async getDeliveryRate(merchantId: string): Promise<number> {
    const logs = await this.getLogs(merchantId, MAX_LOGS);
    if (logs.length === 0) return 100;
    const delivered = logs.filter(l => l.status === 'SENT' || l.status === 'DELIVERED').length;
    return Math.round((delivered / logs.length) * 100);
  }
}

export const merchantNotificationLog = new MerchantNotificationLogService();
