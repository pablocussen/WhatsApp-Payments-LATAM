import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('discount-code');

const DISC_PREFIX = 'disc:';
const DISC_TTL = 180 * 24 * 60 * 60;
const MAX_CODES = 50;

export type DiscountType = 'PERCENTAGE' | 'FIXED';

export interface DiscountCode {
  id: string;
  merchantId: string;
  code: string;
  type: DiscountType;
  value: number; // percentage (5-50) or fixed CLP amount
  minPurchase: number;
  maxUses: number;
  usedCount: number;
  expiresAt: string | null;
  active: boolean;
  createdAt: string;
}

export class DiscountCodeService {
  async createCode(input: {
    merchantId: string;
    code: string;
    type: DiscountType;
    value: number;
    minPurchase?: number;
    maxUses?: number;
    expiresInDays?: number;
  }): Promise<DiscountCode> {
    if (!input.code || input.code.length > 20) throw new Error('Código entre 1 y 20 caracteres.');
    if (input.type === 'PERCENTAGE' && (input.value < 1 || input.value > 50)) throw new Error('Porcentaje entre 1% y 50%.');
    if (input.type === 'FIXED' && input.value < 100) throw new Error('Descuento fijo mínimo: $100.');

    const codes = await this.getCodes(input.merchantId);
    if (codes.length >= MAX_CODES) throw new Error(`Máximo ${MAX_CODES} códigos.`);
    if (codes.some(c => c.code.toUpperCase() === input.code.toUpperCase())) throw new Error('Código duplicado.');

    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

    const discount: DiscountCode = {
      id: `dsc_${Date.now().toString(36)}`,
      merchantId: input.merchantId,
      code: input.code.toUpperCase(),
      type: input.type,
      value: input.value,
      minPurchase: input.minPurchase ?? 0,
      maxUses: input.maxUses ?? 100,
      usedCount: 0,
      expiresAt,
      active: true,
      createdAt: new Date().toISOString(),
    };

    codes.push(discount);
    await this.save(input.merchantId, codes);

    log.info('Discount code created', { merchantId: input.merchantId, code: discount.code });
    return discount;
  }

  async applyCode(merchantId: string, code: string, amount: number): Promise<{ valid: boolean; discount: number; error?: string }> {
    const codes = await this.getCodes(merchantId);
    const disc = codes.find(c => c.code === code.toUpperCase() && c.active);

    if (!disc) return { valid: false, discount: 0, error: 'Código no válido.' };
    if (disc.usedCount >= disc.maxUses) return { valid: false, discount: 0, error: 'Código agotado.' };
    if (disc.expiresAt && new Date() > new Date(disc.expiresAt)) return { valid: false, discount: 0, error: 'Código expirado.' };
    if (amount < disc.minPurchase) return { valid: false, discount: 0, error: `Compra mínima: ${formatCLP(disc.minPurchase)}.` };

    const discount = disc.type === 'PERCENTAGE'
      ? Math.round(amount * disc.value / 100)
      : Math.min(disc.value, amount);

    disc.usedCount++;
    await this.save(merchantId, codes);

    return { valid: true, discount };
  }

  async getCodes(merchantId: string): Promise<DiscountCode[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${DISC_PREFIX}${merchantId}`);
      return raw ? JSON.parse(raw) as DiscountCode[] : [];
    } catch {
      return [];
    }
  }

  async deactivateCode(merchantId: string, codeId: string): Promise<boolean> {
    const codes = await this.getCodes(merchantId);
    const code = codes.find(c => c.id === codeId);
    if (!code) return false;
    code.active = false;
    await this.save(merchantId, codes);
    return true;
  }

  getCodeSummary(disc: DiscountCode): string {
    const val = disc.type === 'PERCENTAGE' ? `${disc.value}%` : formatCLP(disc.value);
    return `${disc.code} — ${val} off — ${disc.usedCount}/${disc.maxUses} usos — ${disc.active ? 'Activo' : 'Inactivo'}`;
  }

  private async save(merchantId: string, codes: DiscountCode[]): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${DISC_PREFIX}${merchantId}`, JSON.stringify(codes), { EX: DISC_TTL });
    } catch (err) {
      log.warn('Failed to save codes', { merchantId, error: (err as Error).message });
    }
  }
}

export const discountCodes = new DiscountCodeService();
