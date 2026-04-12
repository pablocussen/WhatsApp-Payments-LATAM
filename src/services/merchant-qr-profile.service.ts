import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-qr-profile');
const QRP_PREFIX = 'mqrp:';
const QRP_TTL = 365 * 24 * 60 * 60;

export interface MerchantQRProfile {
  merchantId: string;
  displayName: string;
  logoUrl: string | null;
  defaultAmount: number | null;
  defaultDescription: string | null;
  theme: 'DARK' | 'LIGHT' | 'BRAND';
  brandColor: string;
  showSocial: boolean;
  instagram: string | null;
  website: string | null;
  updatedAt: string;
}

export class MerchantQRProfileService {
  async getProfile(merchantId: string): Promise<MerchantQRProfile> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${QRP_PREFIX}${merchantId}`);
      if (raw) return JSON.parse(raw) as MerchantQRProfile;
    } catch { /* defaults */ }
    return {
      merchantId, displayName: '', logoUrl: null, defaultAmount: null,
      defaultDescription: null, theme: 'DARK', brandColor: '#06b6d4',
      showSocial: false, instagram: null, website: null,
      updatedAt: new Date().toISOString(),
    };
  }

  async updateProfile(merchantId: string, updates: Partial<Omit<MerchantQRProfile, 'merchantId' | 'updatedAt'>>): Promise<MerchantQRProfile> {
    const profile = await this.getProfile(merchantId);
    if (updates.displayName !== undefined) {
      if (updates.displayName.length > 50) throw new Error('Nombre máximo 50 caracteres.');
      profile.displayName = updates.displayName;
    }
    if (updates.logoUrl !== undefined) profile.logoUrl = updates.logoUrl;
    if (updates.defaultAmount !== undefined) profile.defaultAmount = updates.defaultAmount;
    if (updates.defaultDescription !== undefined) profile.defaultDescription = updates.defaultDescription;
    if (updates.theme !== undefined) profile.theme = updates.theme;
    if (updates.brandColor !== undefined) {
      if (!/^#[0-9a-fA-F]{6}$/.test(updates.brandColor)) throw new Error('Color debe ser hex (#RRGGBB).');
      profile.brandColor = updates.brandColor;
    }
    if (updates.showSocial !== undefined) profile.showSocial = updates.showSocial;
    if (updates.instagram !== undefined) profile.instagram = updates.instagram;
    if (updates.website !== undefined) profile.website = updates.website;
    profile.updatedAt = new Date().toISOString();

    try {
      const redis = getRedis();
      await redis.set(`${QRP_PREFIX}${merchantId}`, JSON.stringify(profile), { EX: QRP_TTL });
    } catch (err) {
      log.warn('Failed to save QR profile', { merchantId, error: (err as Error).message });
    }
    return profile;
  }

  generateQRData(profile: MerchantQRProfile): string {
    const data: Record<string, unknown> = {
      m: profile.merchantId,
      n: profile.displayName,
    };
    if (profile.defaultAmount) data.a = profile.defaultAmount;
    if (profile.defaultDescription) data.d = profile.defaultDescription;
    return `whatpay://pay?${new URLSearchParams(data as Record<string, string>).toString()}`;
  }
}

export const merchantQRProfile = new MerchantQRProfileService();
