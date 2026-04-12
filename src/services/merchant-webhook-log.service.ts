import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('webhook-log');
const WHL_PREFIX = 'mwhlog:';
const WHL_TTL = 30 * 24 * 60 * 60;
const MAX_LOGS = 200;

export interface WebhookLogEntry {
  id: string;
  merchantId: string;
  subscriptionId: string;
  event: string;
  url: string;
  statusCode: number | null;
  responseMs: number | null;
  success: boolean;
  attempt: number;
  error: string | null;
  payload: string;
  timestamp: string;
}

export class MerchantWebhookLogService {
  async logDelivery(input: Omit<WebhookLogEntry, 'id' | 'timestamp'>): Promise<WebhookLogEntry> {
    const entry: WebhookLogEntry = { ...input, id: `whlog_${Date.now().toString(36)}`, timestamp: new Date().toISOString() };
    try {
      const redis = getRedis();
      await redis.lPush(`${WHL_PREFIX}${input.merchantId}`, JSON.stringify(entry));
      await redis.lTrim(`${WHL_PREFIX}${input.merchantId}`, 0, MAX_LOGS - 1);
      await redis.expire(`${WHL_PREFIX}${input.merchantId}`, WHL_TTL);
    } catch (err) { log.warn('Failed to log webhook', { error: (err as Error).message }); }
    return entry;
  }

  async getLogs(merchantId: string, limit = 50): Promise<WebhookLogEntry[]> {
    try { const redis = getRedis(); const raw = await redis.lRange(`${WHL_PREFIX}${merchantId}`, 0, limit - 1); return raw.map(r => JSON.parse(r) as WebhookLogEntry); }
    catch { return []; }
  }

  async getFailedDeliveries(merchantId: string): Promise<WebhookLogEntry[]> {
    const all = await this.getLogs(merchantId, MAX_LOGS);
    return all.filter(e => !e.success);
  }

  async getSuccessRate(merchantId: string): Promise<number> {
    const all = await this.getLogs(merchantId, MAX_LOGS);
    if (all.length === 0) return 100;
    return Math.round((all.filter(e => e.success).length / all.length) * 100);
  }

  async getAvgResponseTime(merchantId: string): Promise<number> {
    const all = await this.getLogs(merchantId, MAX_LOGS);
    const withResponse = all.filter(e => e.responseMs !== null);
    if (withResponse.length === 0) return 0;
    return Math.round(withResponse.reduce((sum, e) => sum + (e.responseMs ?? 0), 0) / withResponse.length);
  }
}

export const merchantWebhookLog = new MerchantWebhookLogService();
