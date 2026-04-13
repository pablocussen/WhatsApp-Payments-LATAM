import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-end-of-day');
const PREFIX = 'merchant:eod:';
const TTL = 365 * 24 * 60 * 60;

export interface EndOfDayReport {
  id: string;
  merchantId: string;
  date: string;
  openingBalance: number;
  cashSales: number;
  digitalSales: number;
  totalSales: number;
  transactionCount: number;
  refunds: number;
  netRevenue: number;
  expectedCash: number;
  actualCash: number;
  variance: number;
  closedBy: string;
  closedAt: string;
  notes?: string;
}

export class MerchantEndOfDayService {
  private key(merchantId: string): string {
    return `${PREFIX}${merchantId}`;
  }

  async list(merchantId: string): Promise<EndOfDayReport[]> {
    const raw = await getRedis().get(this.key(merchantId));
    return raw ? JSON.parse(raw) : [];
  }

  async close(input: {
    merchantId: string;
    date: string;
    openingBalance: number;
    cashSales: number;
    digitalSales: number;
    transactionCount: number;
    refunds: number;
    actualCash: number;
    closedBy: string;
    notes?: string;
  }): Promise<EndOfDayReport> {
    if (input.cashSales < 0 || input.digitalSales < 0) {
      throw new Error('Ventas no pueden ser negativas');
    }
    if (input.actualCash < 0) throw new Error('Caja actual no puede ser negativa');
    const list = await this.list(input.merchantId);
    if (list.some(r => r.date === input.date)) {
      throw new Error('Ya existe cierre para esta fecha');
    }
    const totalSales = input.cashSales + input.digitalSales;
    const netRevenue = totalSales - input.refunds;
    const expectedCash = input.openingBalance + input.cashSales - input.refunds;
    const variance = input.actualCash - expectedCash;
    const report: EndOfDayReport = {
      id: `eod_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      merchantId: input.merchantId,
      date: input.date,
      openingBalance: input.openingBalance,
      cashSales: input.cashSales,
      digitalSales: input.digitalSales,
      totalSales,
      transactionCount: input.transactionCount,
      refunds: input.refunds,
      netRevenue,
      expectedCash,
      actualCash: input.actualCash,
      variance,
      closedBy: input.closedBy,
      closedAt: new Date().toISOString(),
      notes: input.notes,
    };
    list.push(report);
    if (list.length > 90) list.splice(0, list.length - 90);
    await getRedis().set(this.key(input.merchantId), JSON.stringify(list), { EX: TTL });
    log.info('eod closed', { merchantId: input.merchantId, date: input.date, variance });
    return report;
  }

  async getByDate(merchantId: string, date: string): Promise<EndOfDayReport | null> {
    const list = await this.list(merchantId);
    return list.find(r => r.date === date) ?? null;
  }

  async getVarianceHistory(merchantId: string, days: number): Promise<{ date: string; variance: number }[]> {
    const list = await this.list(merchantId);
    return list.slice(-days).map(r => ({ date: r.date, variance: r.variance }));
  }

  async getWeeklyTotals(merchantId: string): Promise<{ totalSales: number; avgDaily: number; days: number }> {
    const list = await this.list(merchantId);
    const last7 = list.slice(-7);
    const totalSales = last7.reduce((sum, r) => sum + r.totalSales, 0);
    return {
      totalSales,
      avgDaily: last7.length > 0 ? Math.round(totalSales / last7.length) : 0,
      days: last7.length,
    };
  }

  formatReport(r: EndOfDayReport): string {
    const varianceStr = r.variance === 0 ? 'Cuadrada' : r.variance > 0 ? `Sobrante $${r.variance.toLocaleString('es-CL')}` : `Faltante $${Math.abs(r.variance).toLocaleString('es-CL')}`;
    return [
      `Cierre ${r.date}`,
      `Ventas totales: $${r.totalSales.toLocaleString('es-CL')} (${r.transactionCount} tx)`,
      `  Efectivo: $${r.cashSales.toLocaleString('es-CL')}`,
      `  Digital: $${r.digitalSales.toLocaleString('es-CL')}`,
      `Reembolsos: $${r.refunds.toLocaleString('es-CL')}`,
      `Neto: $${r.netRevenue.toLocaleString('es-CL')}`,
      `Caja esperada: $${r.expectedCash.toLocaleString('es-CL')}`,
      `Caja actual: $${r.actualCash.toLocaleString('es-CL')}`,
      `Diferencia: ${varianceStr}`,
      `Cerrado por: ${r.closedBy}`,
    ].join('\n');
  }
}

export const merchantEndOfDay = new MerchantEndOfDayService();
