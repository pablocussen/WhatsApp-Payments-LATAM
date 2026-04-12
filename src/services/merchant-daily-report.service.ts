import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('daily-report');
const DR_PREFIX = 'dailyrep:';
const DR_TTL = 60 * 24 * 60 * 60;

export interface DailyReport {
  merchantId: string;
  date: string;
  totalSales: number;
  totalTransactions: number;
  cashSales: number;
  digitalSales: number;
  refunds: number;
  avgTicket: number;
  topProducts: { name: string; count: number }[];
  peakHour: number;
  uniqueCustomers: number;
  generatedAt: string;
}

export class MerchantDailyReportService {
  async generateReport(merchantId: string, date: string, data: {
    totalSales: number;
    totalTransactions: number;
    cashSales: number;
    digitalSales: number;
    refunds: number;
    topProducts: { name: string; count: number }[];
    peakHour: number;
    uniqueCustomers: number;
  }): Promise<DailyReport> {
    const report: DailyReport = {
      merchantId, date,
      totalSales: data.totalSales,
      totalTransactions: data.totalTransactions,
      cashSales: data.cashSales,
      digitalSales: data.digitalSales,
      refunds: data.refunds,
      avgTicket: data.totalTransactions > 0 ? Math.round(data.totalSales / data.totalTransactions) : 0,
      topProducts: data.topProducts.slice(0, 5),
      peakHour: data.peakHour,
      uniqueCustomers: data.uniqueCustomers,
      generatedAt: new Date().toISOString(),
    };
    try { const redis = getRedis(); await redis.set(DR_PREFIX + merchantId + ':' + date, JSON.stringify(report), { EX: DR_TTL }); }
    catch (err) { log.warn('Failed to save report', { error: (err as Error).message }); }
    return report;
  }

  async getReport(merchantId: string, date: string): Promise<DailyReport | null> {
    try { const redis = getRedis(); const raw = await redis.get(DR_PREFIX + merchantId + ':' + date); return raw ? JSON.parse(raw) as DailyReport : null; }
    catch { return null; }
  }

  formatReport(r: DailyReport): string {
    const digitalPct = r.totalSales > 0 ? Math.round((r.digitalSales / r.totalSales) * 100) : 0;
    return [
      'Reporte diario — ' + r.date,
      'Ventas totales: ' + formatCLP(r.totalSales),
      'Transacciones: ' + r.totalTransactions,
      'Ticket promedio: ' + formatCLP(r.avgTicket),
      'Efectivo: ' + formatCLP(r.cashSales) + ' | Digital: ' + formatCLP(r.digitalSales) + ' (' + digitalPct + '%)',
      'Reembolsos: ' + formatCLP(r.refunds),
      'Clientes unicos: ' + r.uniqueCustomers,
      'Hora peak: ' + r.peakHour + ':00',
    ].join('\n');
  }
}

export const merchantDailyReport = new MerchantDailyReportService();
