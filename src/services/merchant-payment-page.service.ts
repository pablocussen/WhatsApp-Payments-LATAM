import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('payment-page');
const PP_PREFIX = 'mpaypg:';
const PP_TTL = 365 * 24 * 60 * 60;

export interface PaymentPageConfig {
  merchantId: string;
  slug: string;
  title: string;
  description: string;
  logoUrl: string | null;
  primaryColor: string;
  amounts: number[];
  customAmountEnabled: boolean;
  minAmount: number;
  maxAmount: number;
  successMessage: string;
  redirectUrl: string | null;
  active: boolean;
  totalCollected: number;
  totalPayments: number;
  createdAt: string;
}

export class MerchantPaymentPageService {
  async createPage(input: {
    merchantId: string; slug: string; title: string; description: string;
    amounts?: number[]; customAmountEnabled?: boolean; primaryColor?: string;
  }): Promise<PaymentPageConfig> {
    if (!input.slug || !/^[a-z0-9-]+$/.test(input.slug)) throw new Error('Slug debe ser alfanumerico con guiones.');
    if (input.slug.length > 30) throw new Error('Slug maximo 30 caracteres.');
    if (!input.title) throw new Error('Titulo requerido.');

    const page: PaymentPageConfig = {
      merchantId: input.merchantId, slug: input.slug, title: input.title,
      description: input.description, logoUrl: null,
      primaryColor: input.primaryColor ?? '#06b6d4',
      amounts: input.amounts ?? [5000, 10000, 20000, 50000],
      customAmountEnabled: input.customAmountEnabled ?? true,
      minAmount: 100, maxAmount: 2000000,
      successMessage: 'Pago recibido exitosamente!',
      redirectUrl: null, active: true,
      totalCollected: 0, totalPayments: 0,
      createdAt: new Date().toISOString(),
    };
    try { const redis = getRedis(); await redis.set(`${PP_PREFIX}${input.slug}`, JSON.stringify(page), { EX: PP_TTL }); }
    catch (err) { log.warn('Failed to save payment page', { error: (err as Error).message }); }
    log.info('Payment page created', { merchantId: input.merchantId, slug: input.slug });
    return page;
  }

  async getPage(slug: string): Promise<PaymentPageConfig | null> {
    try { const redis = getRedis(); const raw = await redis.get(`${PP_PREFIX}${slug}`); return raw ? JSON.parse(raw) as PaymentPageConfig : null; }
    catch { return null; }
  }

  async recordPayment(slug: string, amount: number): Promise<boolean> {
    const page = await this.getPage(slug);
    if (!page || !page.active) return false;
    if (amount < page.minAmount || amount > page.maxAmount) return false;
    page.totalCollected += amount; page.totalPayments++;
    try { const redis = getRedis(); await redis.set(`${PP_PREFIX}${slug}`, JSON.stringify(page), { EX: PP_TTL }); }
    catch { return false; }
    return true;
  }

  getPageUrl(slug: string): string {
    return `https://whatpay.cl/pay/${slug}`;
  }

  formatPageSummary(page: PaymentPageConfig): string {
    return `${page.title} (/${page.slug}) — ${page.totalPayments} pagos, ${formatCLP(page.totalCollected)} recaudado`;
  }
}

export const merchantPaymentPage = new MerchantPaymentPageService();
