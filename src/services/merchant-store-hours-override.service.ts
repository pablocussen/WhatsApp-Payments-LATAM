import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('hours-override');
const HO_PREFIX = 'hoursover:';
const HO_TTL = 365 * 24 * 60 * 60;

export type OverrideType = 'CLOSED' | 'EXTENDED' | 'REDUCED' | 'SPECIAL';

export interface HoursOverride {
  id: string;
  merchantId: string;
  date: string;
  type: OverrideType;
  openTime: string | null;
  closeTime: string | null;
  reason: string;
  createdAt: string;
}

export class MerchantStoreHoursOverrideService {
  async createOverride(input: { merchantId: string; date: string; type: OverrideType; openTime?: string; closeTime?: string; reason: string }): Promise<HoursOverride> {
    if (!input.date) throw new Error('Fecha requerida.');
    if (input.type !== 'CLOSED' && (!input.openTime || !input.closeTime)) {
      throw new Error('Horarios requeridos para tipo no-CLOSED.');
    }

    const override: HoursOverride = {
      id: 'over_' + Date.now().toString(36),
      merchantId: input.merchantId,
      date: input.date,
      type: input.type,
      openTime: input.openTime ?? null,
      closeTime: input.closeTime ?? null,
      reason: input.reason,
      createdAt: new Date().toISOString(),
    };

    try { const redis = getRedis(); await redis.set(HO_PREFIX + input.merchantId + ':' + input.date, JSON.stringify(override), { EX: HO_TTL }); }
    catch (err) { log.warn('Failed to save override', { error: (err as Error).message }); }
    return override;
  }

  async getOverride(merchantId: string, date: string): Promise<HoursOverride | null> {
    try { const redis = getRedis(); const raw = await redis.get(HO_PREFIX + merchantId + ':' + date); return raw ? JSON.parse(raw) as HoursOverride : null; }
    catch { return null; }
  }

  async deleteOverride(merchantId: string, date: string): Promise<boolean> {
    try { const redis = getRedis(); await redis.set(HO_PREFIX + merchantId + ':' + date, '', { EX: 1 }); return true; }
    catch { return false; }
  }

  isClosed(override: HoursOverride): boolean {
    return override.type === 'CLOSED';
  }

  isOpenAt(override: HoursOverride, time: string): boolean {
    if (override.type === 'CLOSED') return false;
    if (!override.openTime || !override.closeTime) return false;
    return time >= override.openTime && time < override.closeTime;
  }
}

export const merchantStoreHoursOverride = new MerchantStoreHoursOverrideService();
