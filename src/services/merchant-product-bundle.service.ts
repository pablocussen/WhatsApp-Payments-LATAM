import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('product-bundle');
const PB_PREFIX = 'pbundle:';
const PB_TTL = 365 * 24 * 60 * 60;

export interface BundleItem {
  productId: string;
  name: string;
  quantity: number;
  individualPrice: number;
}

export interface ProductBundle {
  id: string;
  merchantId: string;
  name: string;
  items: BundleItem[];
  totalIndividualPrice: number;
  bundlePrice: number;
  discount: number;
  active: boolean;
  createdAt: string;
}

export class MerchantProductBundleService {
  async createBundle(input: { merchantId: string; name: string; items: BundleItem[]; bundlePrice: number }): Promise<ProductBundle> {
    if (!input.name) throw new Error('Nombre requerido.');
    if (input.items.length < 2) throw new Error('Bundle requiere al menos 2 productos.');
    if (input.items.length > 20) throw new Error('Maximo 20 productos por bundle.');

    const totalIndividual = input.items.reduce((s, i) => s + (i.individualPrice * i.quantity), 0);
    if (input.bundlePrice >= totalIndividual) throw new Error('Bundle debe ser mas barato que la suma individual.');

    const bundle: ProductBundle = {
      id: 'bnd_' + Date.now().toString(36),
      merchantId: input.merchantId,
      name: input.name,
      items: input.items,
      totalIndividualPrice: totalIndividual,
      bundlePrice: input.bundlePrice,
      discount: totalIndividual - input.bundlePrice,
      active: true,
      createdAt: new Date().toISOString(),
    };
    try { const redis = getRedis(); await redis.set(PB_PREFIX + bundle.id, JSON.stringify(bundle), { EX: PB_TTL }); }
    catch (err) { log.warn('Failed to save bundle', { error: (err as Error).message }); }
    return bundle;
  }

  async getBundle(id: string): Promise<ProductBundle | null> {
    try { const redis = getRedis(); const raw = await redis.get(PB_PREFIX + id); return raw ? JSON.parse(raw) as ProductBundle : null; }
    catch { return null; }
  }

  async deactivate(id: string): Promise<boolean> {
    const bundle = await this.getBundle(id);
    if (!bundle) return false;
    bundle.active = false;
    try { const redis = getRedis(); await redis.set(PB_PREFIX + id, JSON.stringify(bundle), { EX: PB_TTL }); }
    catch { return false; }
    return true;
  }

  getDiscountPercent(bundle: ProductBundle): number {
    return Math.round((bundle.discount / bundle.totalIndividualPrice) * 100);
  }

  formatBundleSummary(b: ProductBundle): string {
    const pct = this.getDiscountPercent(b);
    return b.name + ': ' + b.items.length + ' productos por ' + formatCLP(b.bundlePrice) + ' (ahorro ' + formatCLP(b.discount) + ', ' + pct + '% off)';
  }
}

export const merchantProductBundle = new MerchantProductBundleService();
