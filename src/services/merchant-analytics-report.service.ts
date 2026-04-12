import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('merchant-analytics-report');
const MAR_PREFIX = 'manarep:';
const MAR_TTL = 90 * 24 * 60 * 60;

export interface AnalyticsReport {
  merchantId: string;
  period: string;
  revenue: number;
  transactions: number;
  uniqueCustomers: number;
  avgTicket: number;
  topProducts: { name: string; revenue: number; count: number }[];
  peakHour: number;
  peakDay: string;
  returnRate: number;
  churnRate: number;
  growthVsPrevious: number;
  generatedAt: string;
}

export class MerchantAnalyticsReportService {
  async generateReport(merchantId: string, data: {
    revenue: number; transactions: number; uniqueCustomers: number;
    topProducts: { name: string; revenue: number; count: number }[];
    peakHour: number; peakDay: string; returnRate: number;
    previousRevenue: number;
  }): Promise<AnalyticsReport> {
    const avgTicket = data.transactions > 0 ? Math.round(data.revenue / data.transactions) : 0;
    const growth = data.previousRevenue > 0 ? Math.round(((data.revenue - data.previousRevenue) / data.previousRevenue) * 100) : 0;

    const report: AnalyticsReport = {
      merchantId, period: new Date().toISOString().slice(0, 7),
      revenue: data.revenue, transactions: data.transactions,
      uniqueCustomers: data.uniqueCustomers, avgTicket,
      topProducts: data.topProducts.slice(0, 5),
      peakHour: data.peakHour, peakDay: data.peakDay,
      returnRate: data.returnRate, churnRate: Math.max(0, 100 - data.returnRate),
      growthVsPrevious: growth, generatedAt: new Date().toISOString(),
    };

    try { const redis = getRedis(); await redis.set(`${MAR_PREFIX}${merchantId}:${report.period}`, JSON.stringify(report), { EX: MAR_TTL }); }
    catch (err) { log.warn('Failed to save report', { merchantId, error: (err as Error).message }); }
    return report;
  }

  async getReport(merchantId: string, period?: string): Promise<AnalyticsReport | null> {
    const p = period ?? new Date().toISOString().slice(0, 7);
    try { const redis = getRedis(); const raw = await redis.get(`${MAR_PREFIX}${merchantId}:${p}`); return raw ? JSON.parse(raw) as AnalyticsReport : null; }
    catch { return null; }
  }

  formatReportSummary(r: AnalyticsReport): string {
    const arrow = r.growthVsPrevious > 0 ? '↑' : r.growthVsPrevious < 0 ? '↓' : '→';
    return [
      `${r.period}: ${formatCLP(r.revenue)} (${r.transactions} tx)`,
      `Ticket promedio: ${formatCLP(r.avgTicket)}`,
      `Clientes: ${r.uniqueCustomers} (${r.returnRate}% retorno)`,
      `Crecimiento: ${arrow} ${Math.abs(r.growthVsPrevious)}%`,
      `Peak: ${r.peakDay} a las ${r.peakHour}:00`,
    ].join('\n');
  }
}

export const merchantAnalyticsReport = new MerchantAnalyticsReportService();
