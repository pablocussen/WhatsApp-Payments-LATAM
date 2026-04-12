import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('coupon-campaign');
const CC_PREFIX = 'cpncamp:';
const CC_TTL = 365 * 24 * 60 * 60;

export type CampaignStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ENDED';

export interface CouponCampaign {
  id: string;
  merchantId: string;
  name: string;
  description: string;
  couponCode: string;
  targetAudience: 'ALL' | 'NEW_CUSTOMERS' | 'VIP' | 'INACTIVE';
  startDate: string;
  endDate: string;
  redemptions: number;
  maxRedemptions: number;
  totalDiscount: number;
  status: CampaignStatus;
  createdAt: string;
}

export class MerchantCouponCampaignService {
  async createCampaign(input: {
    merchantId: string; name: string; description: string; couponCode: string;
    targetAudience: CouponCampaign['targetAudience']; durationDays: number; maxRedemptions: number;
  }): Promise<CouponCampaign> {
    if (!input.name) throw new Error('Nombre requerido.');
    if (input.durationDays < 1 || input.durationDays > 365) throw new Error('Duracion entre 1 y 365 dias.');

    const start = new Date();
    const end = new Date(Date.now() + input.durationDays * 24 * 60 * 60 * 1000);

    const campaign: CouponCampaign = {
      id: 'camp_' + Date.now().toString(36),
      merchantId: input.merchantId,
      name: input.name,
      description: input.description,
      couponCode: input.couponCode.toUpperCase(),
      targetAudience: input.targetAudience,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      redemptions: 0,
      maxRedemptions: input.maxRedemptions,
      totalDiscount: 0,
      status: 'DRAFT',
      createdAt: new Date().toISOString(),
    };

    try { const redis = getRedis(); await redis.set(CC_PREFIX + campaign.id, JSON.stringify(campaign), { EX: CC_TTL }); }
    catch (err) { log.warn('Failed to save campaign', { error: (err as Error).message }); }
    return campaign;
  }

  async activate(id: string): Promise<boolean> {
    const c = await this.getCampaign(id);
    if (!c || c.status === 'ENDED') return false;
    c.status = 'ACTIVE';
    try { const redis = getRedis(); await redis.set(CC_PREFIX + id, JSON.stringify(c), { EX: CC_TTL }); }
    catch { return false; }
    return true;
  }

  async pause(id: string): Promise<boolean> {
    const c = await this.getCampaign(id);
    if (!c || c.status !== 'ACTIVE') return false;
    c.status = 'PAUSED';
    try { const redis = getRedis(); await redis.set(CC_PREFIX + id, JSON.stringify(c), { EX: CC_TTL }); }
    catch { return false; }
    return true;
  }

  async recordRedemption(id: string, discountAmount: number): Promise<boolean> {
    const c = await this.getCampaign(id);
    if (!c || c.status !== 'ACTIVE') return false;
    if (c.redemptions >= c.maxRedemptions) {
      c.status = 'ENDED';
    } else {
      c.redemptions++;
      c.totalDiscount += discountAmount;
      if (c.redemptions >= c.maxRedemptions) c.status = 'ENDED';
    }
    try { const redis = getRedis(); await redis.set(CC_PREFIX + id, JSON.stringify(c), { EX: CC_TTL }); }
    catch { return false; }
    return true;
  }

  async getCampaign(id: string): Promise<CouponCampaign | null> {
    try { const redis = getRedis(); const raw = await redis.get(CC_PREFIX + id); return raw ? JSON.parse(raw) as CouponCampaign : null; }
    catch { return null; }
  }

  formatCampaignSummary(c: CouponCampaign): string {
    return c.name + ' (' + c.couponCode + '): ' + c.redemptions + '/' + c.maxRedemptions + ' redenciones, ' + formatCLP(c.totalDiscount) + ' descontado — ' + c.status;
  }
}

export const merchantCouponCampaign = new MerchantCouponCampaignService();
