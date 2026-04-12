import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('merchant-coupon');
const COUPON_PREFIX = 'mcoupon:';
const COUPON_TTL = 180 * 24 * 60 * 60;

export interface Coupon {
  id: string;
  merchantId: string;
  code: string;
  description: string;
  discountPercent: number;
  maxDiscount: number;
  minPurchase: number;
  validFrom: string;
  validUntil: string;
  maxRedemptions: number;
  redemptionCount: number;
  active: boolean;
  createdAt: string;
}

export class MerchantCouponService {
  async createCoupon(input: {
    merchantId: string; code: string; description: string;
    discountPercent: number; maxDiscount: number; minPurchase: number;
    validDays: number; maxRedemptions: number;
  }): Promise<Coupon> {
    if (!input.code || input.code.length > 15) throw new Error('Codigo entre 1 y 15 caracteres.');
    if (input.discountPercent < 1 || input.discountPercent > 100) throw new Error('Descuento entre 1% y 100%.');
    const coupon: Coupon = {
      id: `cpn_${Date.now().toString(36)}`, merchantId: input.merchantId,
      code: input.code.toUpperCase(), description: input.description,
      discountPercent: input.discountPercent, maxDiscount: input.maxDiscount,
      minPurchase: input.minPurchase,
      validFrom: new Date().toISOString(),
      validUntil: new Date(Date.now() + input.validDays * 24 * 60 * 60 * 1000).toISOString(),
      maxRedemptions: input.maxRedemptions, redemptionCount: 0,
      active: true, createdAt: new Date().toISOString(),
    };
    try { const redis = getRedis(); await redis.set(`${COUPON_PREFIX}${coupon.code}`, JSON.stringify(coupon), { EX: COUPON_TTL }); }
    catch (err) { log.warn('Failed to save coupon', { error: (err as Error).message }); }
    log.info('Coupon created', { couponId: coupon.id, code: coupon.code });
    return coupon;
  }

  async redeemCoupon(code: string, purchaseAmount: number): Promise<{ valid: boolean; discount: number; error?: string }> {
    const coupon = await this.getCoupon(code);
    if (!coupon || !coupon.active) return { valid: false, discount: 0, error: 'Cupon no valido.' };
    if (new Date() > new Date(coupon.validUntil)) return { valid: false, discount: 0, error: 'Cupon expirado.' };
    if (coupon.redemptionCount >= coupon.maxRedemptions) return { valid: false, discount: 0, error: 'Cupon agotado.' };
    if (purchaseAmount < coupon.minPurchase) return { valid: false, discount: 0, error: `Compra minima: ${formatCLP(coupon.minPurchase)}.` };
    const rawDiscount = Math.round(purchaseAmount * coupon.discountPercent / 100);
    const discount = Math.min(rawDiscount, coupon.maxDiscount);
    coupon.redemptionCount++;
    try { const redis = getRedis(); await redis.set(`${COUPON_PREFIX}${code}`, JSON.stringify(coupon), { EX: COUPON_TTL }); }
    catch { /* ignore */ }
    return { valid: true, discount };
  }

  async getCoupon(code: string): Promise<Coupon | null> {
    try { const redis = getRedis(); const raw = await redis.get(`${COUPON_PREFIX}${code.toUpperCase()}`); return raw ? JSON.parse(raw) as Coupon : null; }
    catch { return null; }
  }

  async deactivate(code: string): Promise<boolean> {
    const coupon = await this.getCoupon(code);
    if (!coupon) return false;
    coupon.active = false;
    try { const redis = getRedis(); await redis.set(`${COUPON_PREFIX}${code}`, JSON.stringify(coupon), { EX: COUPON_TTL }); }
    catch { return false; }
    return true;
  }
}

export const merchantCoupons = new MerchantCouponService();
