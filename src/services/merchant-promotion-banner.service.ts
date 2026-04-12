import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('promo-banner');
const PB_PREFIX = 'promobnr:';
const PB_TTL = 90 * 24 * 60 * 60;

export type BannerPosition = 'TOP' | 'MIDDLE' | 'BOTTOM' | 'POPUP';

export interface PromoBanner {
  id: string;
  merchantId: string;
  title: string;
  message: string;
  ctaText: string;
  ctaUrl: string;
  position: BannerPosition;
  bgColor: string;
  textColor: string;
  startDate: string;
  endDate: string;
  impressions: number;
  clicks: number;
  active: boolean;
  createdAt: string;
}

export class MerchantPromotionBannerService {
  async createBanner(input: {
    merchantId: string; title: string; message: string;
    ctaText: string; ctaUrl: string; position: BannerPosition;
    bgColor?: string; textColor?: string; durationDays: number;
  }): Promise<PromoBanner> {
    if (!input.title || input.title.length > 50) throw new Error('Titulo entre 1 y 50 caracteres.');
    if (!input.message || input.message.length > 200) throw new Error('Mensaje entre 1 y 200 caracteres.');
    if (input.durationDays < 1 || input.durationDays > 90) throw new Error('Duracion entre 1 y 90 dias.');

    const banner: PromoBanner = {
      id: 'bnr_' + Date.now().toString(36),
      merchantId: input.merchantId,
      title: input.title,
      message: input.message,
      ctaText: input.ctaText,
      ctaUrl: input.ctaUrl,
      position: input.position,
      bgColor: input.bgColor ?? '#06b6d4',
      textColor: input.textColor ?? '#ffffff',
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + input.durationDays * 24 * 60 * 60 * 1000).toISOString(),
      impressions: 0,
      clicks: 0,
      active: true,
      createdAt: new Date().toISOString(),
    };
    try { const redis = getRedis(); await redis.set(PB_PREFIX + banner.id, JSON.stringify(banner), { EX: PB_TTL }); }
    catch (err) { log.warn('Failed to save banner', { error: (err as Error).message }); }
    return banner;
  }

  async trackImpression(bannerId: string): Promise<void> {
    const banner = await this.getBanner(bannerId);
    if (!banner || !banner.active) return;
    banner.impressions++;
    try { const redis = getRedis(); await redis.set(PB_PREFIX + bannerId, JSON.stringify(banner), { EX: PB_TTL }); }
    catch { /* ignore */ }
  }

  async trackClick(bannerId: string): Promise<void> {
    const banner = await this.getBanner(bannerId);
    if (!banner || !banner.active) return;
    banner.clicks++;
    try { const redis = getRedis(); await redis.set(PB_PREFIX + bannerId, JSON.stringify(banner), { EX: PB_TTL }); }
    catch { /* ignore */ }
  }

  async getBanner(id: string): Promise<PromoBanner | null> {
    try { const redis = getRedis(); const raw = await redis.get(PB_PREFIX + id); return raw ? JSON.parse(raw) as PromoBanner : null; }
    catch { return null; }
  }

  async deactivate(id: string): Promise<boolean> {
    const banner = await this.getBanner(id);
    if (!banner) return false;
    banner.active = false;
    try { const redis = getRedis(); await redis.set(PB_PREFIX + id, JSON.stringify(banner), { EX: PB_TTL }); }
    catch { return false; }
    return true;
  }

  getCTR(banner: PromoBanner): number {
    return banner.impressions > 0 ? Math.round((banner.clicks / banner.impressions) * 10000) / 100 : 0;
  }
}

export const merchantPromotionBanner = new MerchantPromotionBannerService();
