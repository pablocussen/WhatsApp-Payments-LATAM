import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('product-variant');
const PV_PREFIX = 'pvariant:';
const PV_TTL = 365 * 24 * 60 * 60;

export interface ProductVariant {
  id: string;
  productId: string;
  name: string;
  sku: string;
  price: number;
  stock: number | null;
  attributes: Record<string, string>;
  active: boolean;
}

export class MerchantProductVariantService {
  async addVariant(productId: string, input: Omit<ProductVariant, 'id' | 'productId' | 'active'>): Promise<ProductVariant> {
    if (!input.name) throw new Error('Nombre requerido.');
    if (input.price < 0) throw new Error('Precio no puede ser negativo.');

    const variants = await this.getVariants(productId);
    if (variants.length >= 50) throw new Error('Maximo 50 variantes por producto.');
    if (variants.some(v => v.sku === input.sku)) throw new Error('SKU duplicado.');

    const variant: ProductVariant = {
      id: 'var_' + Date.now().toString(36),
      productId, ...input, active: true,
    };
    variants.push(variant);
    await this.save(productId, variants);
    return variant;
  }

  async getVariants(productId: string): Promise<ProductVariant[]> {
    try { const redis = getRedis(); const raw = await redis.get(PV_PREFIX + productId); return raw ? JSON.parse(raw) as ProductVariant[] : []; }
    catch { return []; }
  }

  async getActiveVariants(productId: string): Promise<ProductVariant[]> {
    const all = await this.getVariants(productId);
    return all.filter(v => v.active && (v.stock === null || v.stock > 0));
  }

  async updateStock(productId: string, variantId: string, delta: number): Promise<boolean> {
    const variants = await this.getVariants(productId);
    const v = variants.find(x => x.id === variantId);
    if (!v || v.stock === null) return false;
    const newStock = v.stock + delta;
    if (newStock < 0) return false;
    v.stock = newStock;
    await this.save(productId, variants);
    return true;
  }

  async deactivateVariant(productId: string, variantId: string): Promise<boolean> {
    const variants = await this.getVariants(productId);
    const v = variants.find(x => x.id === variantId);
    if (!v) return false;
    v.active = false;
    await this.save(productId, variants);
    return true;
  }

  formatVariantSummary(v: ProductVariant): string {
    const parts = [v.name, formatCLP(v.price)];
    if (v.stock !== null) parts.push('Stock: ' + v.stock);
    const attrs = Object.entries(v.attributes).map(([k, val]) => k + ': ' + val);
    if (attrs.length > 0) parts.push(attrs.join(', '));
    return parts.join(' — ');
  }

  private async save(productId: string, variants: ProductVariant[]): Promise<void> {
    try { const redis = getRedis(); await redis.set(PV_PREFIX + productId, JSON.stringify(variants), { EX: PV_TTL }); }
    catch (err) { log.warn('Failed to save variants', { error: (err as Error).message }); }
  }
}

export const merchantProductVariant = new MerchantProductVariantService();
