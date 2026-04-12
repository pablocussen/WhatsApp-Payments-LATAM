import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('referral-link');
const RL_PREFIX = 'reflink:';
const RL_TTL = 365 * 24 * 60 * 60;

export interface ReferralLink {
  id: string;
  userId: string;
  code: string;
  url: string;
  clicks: number;
  signups: number;
  conversionRate: number;
  channel: string;
  createdAt: string;
}

export class UserReferralLinkService {
  async createLink(userId: string, channel: string = 'whatsapp'): Promise<ReferralLink> {
    const code = `WP${userId.slice(-4).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const link: ReferralLink = {
      id: `rl_${Date.now().toString(36)}`, userId, code,
      url: `https://whatpay.cl/r/${code}`, clicks: 0, signups: 0,
      conversionRate: 0, channel, createdAt: new Date().toISOString(),
    };
    try { const redis = getRedis(); await redis.set(`${RL_PREFIX}${code}`, JSON.stringify(link), { EX: RL_TTL }); }
    catch (err) { log.warn('Failed to save referral link', { error: (err as Error).message }); }
    return link;
  }

  async getLink(code: string): Promise<ReferralLink | null> {
    try { const redis = getRedis(); const raw = await redis.get(`${RL_PREFIX}${code}`); return raw ? JSON.parse(raw) as ReferralLink : null; }
    catch { return null; }
  }

  async recordClick(code: string): Promise<void> {
    const link = await this.getLink(code);
    if (!link) return;
    link.clicks++;
    link.conversionRate = link.clicks > 0 ? Math.round((link.signups / link.clicks) * 100) : 0;
    try { const redis = getRedis(); await redis.set(`${RL_PREFIX}${code}`, JSON.stringify(link), { EX: RL_TTL }); }
    catch { /* ignore */ }
  }

  async recordSignup(code: string): Promise<void> {
    const link = await this.getLink(code);
    if (!link) return;
    link.signups++;
    link.conversionRate = link.clicks > 0 ? Math.round((link.signups / link.clicks) * 100) : 0;
    try { const redis = getRedis(); await redis.set(`${RL_PREFIX}${code}`, JSON.stringify(link), { EX: RL_TTL }); }
    catch { /* ignore */ }
  }
}

export const userReferralLink = new UserReferralLinkService();
