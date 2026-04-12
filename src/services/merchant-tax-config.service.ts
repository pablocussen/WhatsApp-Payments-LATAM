import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('merchant-tax');
const TAX_PREFIX = 'mtax:';
const TAX_TTL = 365 * 24 * 60 * 60;

export type DocumentType = 'BOLETA' | 'FACTURA';

export interface TaxConfig {
  merchantId: string;
  ivaRate: number;
  documentType: DocumentType;
  rut: string | null;
  razonSocial: string | null;
  exemptCategories: string[];
  autoCalculate: boolean;
  updatedAt: string;
}

export interface TaxCalculation {
  subtotal: number;
  ivaAmount: number;
  total: number;
  isExempt: boolean;
  rate: number;
}

export class MerchantTaxConfigService {
  async getConfig(merchantId: string): Promise<TaxConfig> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${TAX_PREFIX}${merchantId}`);
      if (raw) return JSON.parse(raw) as TaxConfig;
    } catch { /* defaults */ }
    return {
      merchantId, ivaRate: 19, documentType: 'BOLETA', rut: null,
      razonSocial: null, exemptCategories: [], autoCalculate: true,
      updatedAt: new Date().toISOString(),
    };
  }

  async updateConfig(merchantId: string, updates: Partial<Omit<TaxConfig, 'merchantId' | 'updatedAt'>>): Promise<TaxConfig> {
    const config = await this.getConfig(merchantId);
    if (updates.ivaRate !== undefined) {
      if (updates.ivaRate < 0 || updates.ivaRate > 100) throw new Error('IVA debe ser entre 0% y 100%.');
      config.ivaRate = updates.ivaRate;
    }
    if (updates.documentType !== undefined) {
      if (updates.documentType === 'FACTURA' && !config.rut && !updates.rut) throw new Error('RUT requerido para factura.');
      config.documentType = updates.documentType;
    }
    if (updates.rut !== undefined) config.rut = updates.rut;
    if (updates.razonSocial !== undefined) config.razonSocial = updates.razonSocial;
    if (updates.exemptCategories !== undefined) config.exemptCategories = updates.exemptCategories;
    if (updates.autoCalculate !== undefined) config.autoCalculate = updates.autoCalculate;
    config.updatedAt = new Date().toISOString();
    try {
      const redis = getRedis();
      await redis.set(`${TAX_PREFIX}${merchantId}`, JSON.stringify(config), { EX: TAX_TTL });
    } catch (err) {
      log.warn('Failed to save tax config', { merchantId, error: (err as Error).message });
    }
    return config;
  }

  calculateTax(config: TaxConfig, subtotal: number, category?: string): TaxCalculation {
    const isExempt = category ? config.exemptCategories.includes(category) : false;
    const rate = isExempt ? 0 : config.ivaRate;
    const ivaAmount = Math.round(subtotal * rate / 100);
    return { subtotal, ivaAmount, total: subtotal + ivaAmount, isExempt, rate };
  }

  formatTaxSummary(totalCollected: number, totalExempt: number, rate: number): string {
    return `IVA ${rate}% | Recaudado: ${formatCLP(totalCollected)} | Exento: ${formatCLP(totalExempt)}`;
  }
}

export const merchantTaxConfig = new MerchantTaxConfigService();
