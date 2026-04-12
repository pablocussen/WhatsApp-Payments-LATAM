import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-api-log');
const ALOG_PREFIX = 'mapilog:';
const ALOG_TTL = 30 * 24 * 60 * 60;
const MAX_LOGS = 500;

export interface APILogEntry {
  id: string;
  merchantId: string;
  method: string;
  endpoint: string;
  statusCode: number;
  responseMs: number;
  ipAddress: string;
  userAgent: string;
  requestBody: string | null;
  error: string | null;
  timestamp: string;
}

export class MerchantAPILogService {
  async logRequest(input: Omit<APILogEntry, 'id' | 'timestamp'>): Promise<APILogEntry> {
    const entry: APILogEntry = { ...input, id: `alog_${Date.now().toString(36)}`, timestamp: new Date().toISOString() };
    try {
      const redis = getRedis();
      await redis.lPush(`${ALOG_PREFIX}${input.merchantId}`, JSON.stringify(entry));
      await redis.lTrim(`${ALOG_PREFIX}${input.merchantId}`, 0, MAX_LOGS - 1);
      await redis.expire(`${ALOG_PREFIX}${input.merchantId}`, ALOG_TTL);
    } catch (err) { log.warn('Failed to log API request', { error: (err as Error).message }); }
    return entry;
  }

  async getLogs(merchantId: string, limit = 50): Promise<APILogEntry[]> {
    try { const redis = getRedis(); const raw = await redis.lRange(`${ALOG_PREFIX}${merchantId}`, 0, limit - 1); return raw.map(r => JSON.parse(r) as APILogEntry); }
    catch { return []; }
  }

  async getErrorLogs(merchantId: string, limit = 20): Promise<APILogEntry[]> {
    const all = await this.getLogs(merchantId, MAX_LOGS);
    return all.filter(e => e.statusCode >= 400).slice(0, limit);
  }

  async getSlowRequests(merchantId: string, thresholdMs = 1000, limit = 10): Promise<APILogEntry[]> {
    const all = await this.getLogs(merchantId, MAX_LOGS);
    return all.filter(e => e.responseMs >= thresholdMs).sort((a, b) => b.responseMs - a.responseMs).slice(0, limit);
  }

  async getAvgResponseTime(merchantId: string): Promise<number> {
    const all = await this.getLogs(merchantId, MAX_LOGS);
    if (all.length === 0) return 0;
    return Math.round(all.reduce((sum, e) => sum + e.responseMs, 0) / all.length);
  }
}

export const merchantAPILog = new MerchantAPILogService();
