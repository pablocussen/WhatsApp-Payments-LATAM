import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('warranty');
const WT_PREFIX = 'warranty:';
const WT_TTL = 365 * 2 * 24 * 60 * 60;

export type WarrantyStatus = 'ACTIVE' | 'EXPIRED' | 'CLAIMED' | 'VOID';

export interface Warranty {
  id: string;
  merchantId: string;
  productId: string;
  transactionRef: string;
  customerPhone: string;
  durationMonths: number;
  status: WarrantyStatus;
  claimCount: number;
  maxClaims: number;
  startDate: string;
  endDate: string;
  createdAt: string;
}

export class MerchantWarrantyService {
  async createWarranty(input: {
    merchantId: string; productId: string; transactionRef: string;
    customerPhone: string; durationMonths: number; maxClaims?: number;
  }): Promise<Warranty> {
    if (input.durationMonths < 1 || input.durationMonths > 60) throw new Error('Duracion entre 1 y 60 meses.');

    const start = new Date();
    const end = new Date();
    end.setMonth(end.getMonth() + input.durationMonths);

    const warranty: Warranty = {
      id: 'wnty_' + Date.now().toString(36),
      merchantId: input.merchantId,
      productId: input.productId,
      transactionRef: input.transactionRef,
      customerPhone: input.customerPhone,
      durationMonths: input.durationMonths,
      status: 'ACTIVE',
      claimCount: 0,
      maxClaims: input.maxClaims ?? 3,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      createdAt: new Date().toISOString(),
    };

    try { const redis = getRedis(); await redis.set(WT_PREFIX + warranty.id, JSON.stringify(warranty), { EX: WT_TTL }); }
    catch (err) { log.warn('Failed to save warranty', { error: (err as Error).message }); }
    return warranty;
  }

  async claim(warrantyId: string): Promise<{ success: boolean; error?: string }> {
    const w = await this.getWarranty(warrantyId);
    if (!w) return { success: false, error: 'Garantia no encontrada.' };
    if (w.status !== 'ACTIVE') return { success: false, error: 'Garantia no activa.' };
    if (new Date() > new Date(w.endDate)) {
      w.status = 'EXPIRED';
      await this.save(w);
      return { success: false, error: 'Garantia expirada.' };
    }
    if (w.claimCount >= w.maxClaims) return { success: false, error: 'Maximo de reclamos alcanzado.' };

    w.claimCount++;
    if (w.claimCount >= w.maxClaims) w.status = 'CLAIMED';
    await this.save(w);
    return { success: true };
  }

  async voidWarranty(warrantyId: string): Promise<boolean> {
    const w = await this.getWarranty(warrantyId);
    if (!w) return false;
    w.status = 'VOID';
    await this.save(w);
    return true;
  }

  async getWarranty(id: string): Promise<Warranty | null> {
    try { const redis = getRedis(); const raw = await redis.get(WT_PREFIX + id); return raw ? JSON.parse(raw) as Warranty : null; }
    catch { return null; }
  }

  isValid(w: Warranty): boolean {
    return w.status === 'ACTIVE' && new Date() <= new Date(w.endDate) && w.claimCount < w.maxClaims;
  }

  private async save(w: Warranty): Promise<void> {
    try { const redis = getRedis(); await redis.set(WT_PREFIX + w.id, JSON.stringify(w), { EX: WT_TTL }); }
    catch (err) { log.warn('Failed to save warranty', { error: (err as Error).message }); }
  }
}

export const merchantWarranty = new MerchantWarrantyService();
