import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('security-log');
const SL_PREFIX = 'seclog:';
const SL_TTL = 365 * 24 * 60 * 60;
const MAX_LOGS = 200;

export type SecurityEvent = 'LOGIN' | 'LOGIN_FAILED' | 'PIN_CHANGED' | 'PIN_LOCKED' | 'SESSION_REVOKED' | 'KYC_UPDATED' | 'DEVICE_ADDED' | 'SUSPICIOUS_TX' | 'ACCOUNT_LOCKED' | 'ACCOUNT_UNLOCKED' | 'DATA_EXPORTED' | '2FA_ENABLED' | '2FA_DISABLED';

export interface SecurityLogEntry {
  id: string;
  userId: string;
  event: SecurityEvent;
  ipAddress: string;
  userAgent: string;
  details: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  timestamp: string;
}

export class UserSecurityLogService {
  async logEvent(input: Omit<SecurityLogEntry, 'id' | 'timestamp'>): Promise<SecurityLogEntry> {
    const entry: SecurityLogEntry = { ...input, id: `seclog_${Date.now().toString(36)}`, timestamp: new Date().toISOString() };
    try {
      const redis = getRedis();
      await redis.lPush(`${SL_PREFIX}${input.userId}`, JSON.stringify(entry));
      await redis.lTrim(`${SL_PREFIX}${input.userId}`, 0, MAX_LOGS - 1);
      await redis.expire(`${SL_PREFIX}${input.userId}`, SL_TTL);
    } catch (err) { log.warn('Failed to log security event', { error: (err as Error).message }); }
    if (input.riskLevel === 'HIGH') log.info('High risk security event', { userId: input.userId, event: input.event });
    return entry;
  }

  async getLogs(userId: string, limit = 50): Promise<SecurityLogEntry[]> {
    try { const redis = getRedis(); const raw = await redis.lRange(`${SL_PREFIX}${userId}`, 0, limit - 1); return raw.map(r => JSON.parse(r) as SecurityLogEntry); }
    catch { return []; }
  }

  async getHighRiskEvents(userId: string): Promise<SecurityLogEntry[]> {
    const all = await this.getLogs(userId, MAX_LOGS);
    return all.filter(e => e.riskLevel === 'HIGH');
  }

  async getRecentLoginAttempts(userId: string, hours = 24): Promise<{ success: number; failed: number }> {
    const all = await this.getLogs(userId, MAX_LOGS);
    const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
    const recent = all.filter(e => (e.event === 'LOGIN' || e.event === 'LOGIN_FAILED') && new Date(e.timestamp) > cutoff);
    return { success: recent.filter(e => e.event === 'LOGIN').length, failed: recent.filter(e => e.event === 'LOGIN_FAILED').length };
  }
}

export const userSecurityLog = new UserSecurityLogService();
