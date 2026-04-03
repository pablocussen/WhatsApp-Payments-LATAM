import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('consent');

const PREFIX = 'consent:';
const TTL = 365 * 24 * 60 * 60; // 1 year

export type ConsentType =
  | 'tos'               // Terms of Service acceptance
  | 'privacy'           // Privacy Policy acceptance
  | 'messaging'         // Consent to receive WhatsApp messages
  | 'marketing';        // Marketing communications

export interface ConsentRecord {
  userId: string;
  waId: string;
  type: ConsentType;
  granted: boolean;
  grantedAt: string;
  version: string;      // Policy version at time of consent
  ip?: string;
  method: 'bot' | 'api' | 'web';
}

/**
 * Manages user consent records for privacy and legal compliance.
 * Required by WhatsApp Business Policy and Chilean data protection laws.
 */
export class ConsentService {
  /**
   * Record that a user has granted consent.
   */
  async grant(input: {
    userId: string;
    waId: string;
    type: ConsentType;
    version?: string;
    ip?: string;
    method?: 'bot' | 'api' | 'web';
  }): Promise<ConsentRecord> {
    const record: ConsentRecord = {
      userId: input.userId,
      waId: input.waId,
      type: input.type,
      granted: true,
      grantedAt: new Date().toISOString(),
      version: input.version ?? '1.0',
      ip: input.ip,
      method: input.method ?? 'bot',
    };

    const redis = getRedis();
    const key = `${PREFIX}${input.userId}:${input.type}`;
    await redis.set(key, JSON.stringify(record), { EX: TTL });

    // Also track in a per-user set for easy lookup
    await redis.sAdd(`${PREFIX}user:${input.userId}`, input.type);

    log.info('Consent granted', { userId: input.userId, type: input.type, version: record.version });
    return record;
  }

  /**
   * Revoke a specific consent.
   */
  async revoke(userId: string, type: ConsentType): Promise<void> {
    const redis = getRedis();
    const key = `${PREFIX}${userId}:${type}`;
    const existing = await redis.get(key);

    if (existing) {
      const record: ConsentRecord = JSON.parse(existing);
      record.granted = false;
      await redis.set(key, JSON.stringify(record), { EX: TTL });
      log.info('Consent revoked', { userId, type });
    }
  }

  /**
   * Check if user has granted a specific consent.
   */
  async hasConsent(userId: string, type: ConsentType): Promise<boolean> {
    const redis = getRedis();
    const key = `${PREFIX}${userId}:${type}`;
    const raw = await redis.get(key);
    if (!raw) return false;

    const record: ConsentRecord = JSON.parse(raw);
    return record.granted === true;
  }

  /**
   * Get all consent records for a user.
   */
  async getUserConsents(userId: string): Promise<ConsentRecord[]> {
    const redis = getRedis();
    const types = await redis.sMembers(`${PREFIX}user:${userId}`);
    if (types.length === 0) return [];

    const records: ConsentRecord[] = [];
    for (const type of types) {
      const raw = await redis.get(`${PREFIX}${userId}:${type}`);
      if (raw) records.push(JSON.parse(raw));
    }
    return records;
  }

  /**
   * Grant all required consents at registration time.
   */
  async grantRegistrationConsents(input: {
    userId: string;
    waId: string;
    ip?: string;
  }): Promise<void> {
    const base = { userId: input.userId, waId: input.waId, ip: input.ip, method: 'bot' as const };
    await Promise.all([
      this.grant({ ...base, type: 'tos', version: '1.0' }),
      this.grant({ ...base, type: 'privacy', version: '1.0' }),
      this.grant({ ...base, type: 'messaging', version: '1.0' }),
    ]);
  }

  /**
   * Check if a phone number (non-registered user) has been sent a message before.
   * If not, we need to be careful about what we send (WhatsApp opt-in policy).
   */
  async hasThirdPartyConsent(waId: string): Promise<boolean> {
    const redis = getRedis();
    return (await redis.get(`${PREFIX}3p:${waId}`)) !== null;
  }

  /**
   * Record that a third party (non-user) received a business-initiated message
   * and implicitly consented by engaging (replying, clicking a button, etc.).
   */
  async recordThirdPartyContact(waId: string): Promise<void> {
    const redis = getRedis();
    await redis.set(`${PREFIX}3p:${waId}`, new Date().toISOString(), { EX: 180 * 24 * 60 * 60 }); // 180 days
  }
}

export const consent = new ConsentService();
