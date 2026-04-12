import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-branding');
const BR_PREFIX = 'mbrand:';
const BR_TTL = 365 * 24 * 60 * 60;

export interface MerchantBranding {
  merchantId: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  fontFamily: string;
  welcomeMessage: string;
  thankYouMessage: string;
  socialLinks: { platform: string; url: string }[];
  customCss: string | null;
  updatedAt: string;
}

export class MerchantBrandingService {
  async getBranding(merchantId: string): Promise<MerchantBranding> {
    try { const redis = getRedis(); const raw = await redis.get(`${BR_PREFIX}${merchantId}`); if (raw) return JSON.parse(raw) as MerchantBranding; } catch { /* defaults */ }
    return {
      merchantId, logoUrl: null, bannerUrl: null,
      primaryColor: '#06b6d4', secondaryColor: '#10b981', fontFamily: 'Inter',
      welcomeMessage: 'Bienvenido!', thankYouMessage: 'Gracias por tu compra!',
      socialLinks: [], customCss: null, updatedAt: new Date().toISOString(),
    };
  }

  async updateBranding(merchantId: string, updates: Partial<Omit<MerchantBranding, 'merchantId' | 'updatedAt'>>): Promise<MerchantBranding> {
    const branding = await this.getBranding(merchantId);
    if (updates.primaryColor !== undefined) {
      if (!/^#[0-9a-fA-F]{6}$/.test(updates.primaryColor)) throw new Error('Color primario debe ser hex (#RRGGBB).');
      branding.primaryColor = updates.primaryColor;
    }
    if (updates.secondaryColor !== undefined) {
      if (!/^#[0-9a-fA-F]{6}$/.test(updates.secondaryColor)) throw new Error('Color secundario debe ser hex (#RRGGBB).');
      branding.secondaryColor = updates.secondaryColor;
    }
    if (updates.logoUrl !== undefined) branding.logoUrl = updates.logoUrl;
    if (updates.bannerUrl !== undefined) branding.bannerUrl = updates.bannerUrl;
    if (updates.fontFamily !== undefined) branding.fontFamily = updates.fontFamily;
    if (updates.welcomeMessage !== undefined) {
      if (updates.welcomeMessage.length > 200) throw new Error('Mensaje máximo 200 caracteres.');
      branding.welcomeMessage = updates.welcomeMessage;
    }
    if (updates.thankYouMessage !== undefined) branding.thankYouMessage = updates.thankYouMessage;
    if (updates.socialLinks !== undefined) {
      if (updates.socialLinks.length > 5) throw new Error('Máximo 5 redes sociales.');
      branding.socialLinks = updates.socialLinks;
    }
    if (updates.customCss !== undefined) branding.customCss = updates.customCss;
    branding.updatedAt = new Date().toISOString();

    try { const redis = getRedis(); await redis.set(`${BR_PREFIX}${merchantId}`, JSON.stringify(branding), { EX: BR_TTL }); }
    catch (err) { log.warn('Failed to save branding', { merchantId, error: (err as Error).message }); }
    return branding;
  }

  generateThemeCSS(branding: MerchantBranding): string {
    return `:root { --primary: ${branding.primaryColor}; --secondary: ${branding.secondaryColor}; --font: '${branding.fontFamily}', sans-serif; }`;
  }
}

export const merchantBranding = new MerchantBrandingService();
