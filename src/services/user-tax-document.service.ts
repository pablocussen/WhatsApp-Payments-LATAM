import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('user-tax-doc');
const UTD_PREFIX = 'utaxdoc:';
const UTD_TTL = 365 * 24 * 60 * 60;

export interface AnnualTaxSummary {
  userId: string;
  year: number;
  totalReceived: number;
  totalSent: number;
  totalNet: number;
  transactionCount: number;
  topCategories: { category: string; amount: number }[];
  topCounterparts: { phone: string; amount: number }[];
  generatedAt: string;
}

export class UserTaxDocumentService {
  async generateSummary(userId: string, year: number, data: {
    received: number; sent: number; transactions: number;
    categories: Record<string, number>;
    counterparts: Record<string, number>;
  }): Promise<AnnualTaxSummary> {
    if (year < 2020 || year > new Date().getFullYear()) throw new Error('Año invalido.');

    const topCategories = Object.entries(data.categories)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);

    const topCounterparts = Object.entries(data.counterparts)
      .map(([phone, amount]) => ({ phone, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);

    const summary: AnnualTaxSummary = {
      userId, year,
      totalReceived: data.received,
      totalSent: data.sent,
      totalNet: data.received - data.sent,
      transactionCount: data.transactions,
      topCategories, topCounterparts,
      generatedAt: new Date().toISOString(),
    };

    try { const redis = getRedis(); await redis.set(UTD_PREFIX + userId + ':' + year, JSON.stringify(summary), { EX: UTD_TTL }); }
    catch (err) { log.warn('Failed to save tax summary', { error: (err as Error).message }); }
    log.info('Tax summary generated', { userId, year, total: summary.totalNet });
    return summary;
  }

  async getSummary(userId: string, year: number): Promise<AnnualTaxSummary | null> {
    try { const redis = getRedis(); const raw = await redis.get(UTD_PREFIX + userId + ':' + year); return raw ? JSON.parse(raw) as AnnualTaxSummary : null; }
    catch { return null; }
  }

  formatSummary(s: AnnualTaxSummary): string {
    return [
      'Resumen Tributario ' + s.year,
      'Total recibido: ' + formatCLP(s.totalReceived),
      'Total enviado: ' + formatCLP(s.totalSent),
      'Neto: ' + formatCLP(s.totalNet),
      'Transacciones: ' + s.transactionCount,
      'Top 3 categorias: ' + s.topCategories.slice(0, 3).map(c => c.category).join(', '),
    ].join('\n');
  }
}

export const userTaxDocument = new UserTaxDocumentService();
