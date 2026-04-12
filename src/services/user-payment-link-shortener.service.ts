import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('link-shortener');
const LS_PREFIX = 'shortlink:';
const LS_TTL = 90 * 24 * 60 * 60;

export interface ShortLink {
  shortCode: string;
  originalUrl: string;
  userId: string;
  clicks: number;
  createdAt: string;
  expiresAt: string;
  active: boolean;
}

export class UserPaymentLinkShortenerService {
  async createShortLink(userId: string, originalUrl: string, expiresInDays: number = 30): Promise<ShortLink> {
    if (!originalUrl.startsWith('https://')) throw new Error('URL debe usar HTTPS.');
    if (expiresInDays < 1 || expiresInDays > 365) throw new Error('Expiracion entre 1 y 365 dias.');

    const shortCode = this.generateShortCode();
    const link: ShortLink = {
      shortCode,
      originalUrl,
      userId,
      clicks: 0,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString(),
      active: true,
    };

    try { const redis = getRedis(); await redis.set(LS_PREFIX + shortCode, JSON.stringify(link), { EX: LS_TTL }); }
    catch (err) { log.warn('Failed to save short link', { error: (err as Error).message }); }
    log.info('Short link created', { shortCode, userId });
    return link;
  }

  async resolve(shortCode: string): Promise<{ url: string; link: ShortLink } | null> {
    const link = await this.getLink(shortCode);
    if (!link || !link.active) return null;
    if (new Date() > new Date(link.expiresAt)) return null;

    link.clicks++;
    try { const redis = getRedis(); await redis.set(LS_PREFIX + shortCode, JSON.stringify(link), { EX: LS_TTL }); }
    catch { /* ignore */ }
    return { url: link.originalUrl, link };
  }

  async getLink(shortCode: string): Promise<ShortLink | null> {
    try { const redis = getRedis(); const raw = await redis.get(LS_PREFIX + shortCode); return raw ? JSON.parse(raw) as ShortLink : null; }
    catch { return null; }
  }

  async deactivate(shortCode: string): Promise<boolean> {
    const link = await this.getLink(shortCode);
    if (!link) return false;
    link.active = false;
    try { const redis = getRedis(); await redis.set(LS_PREFIX + shortCode, JSON.stringify(link), { EX: LS_TTL }); }
    catch { return false; }
    return true;
  }

  getFullUrl(shortCode: string): string {
    return 'https://whatpay.cl/s/' + shortCode;
  }

  private generateShortCode(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    return Array.from({ length: 7 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }
}

export const userPaymentLinkShortener = new UserPaymentLinkShortenerService();
