import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('merchant-revenue');

const REV_PREFIX = 'mrev:';
const REV_TTL = 180 * 24 * 60 * 60; // 6 months

export type RevenuePeriod = 'TODAY' | 'WEEK' | 'MONTH' | 'CUSTOM';

export interface RevenueEntry {
  date: string; // YYYY-MM-DD
  transactionCount: number;
  grossVolume: number;
  fees: number;
  netRevenue: number;
  refunds: number;
  avgTicket: number;
}

export interface RevenueReport {
  merchantId: string;
  period: RevenuePeriod;
  startDate: string;
  endDate: string;
  entries: RevenueEntry[];
  totals: {
    transactionCount: number;
    grossVolume: number;
    fees: number;
    netRevenue: number;
    refunds: number;
    avgTicket: number;
  };
  generatedAt: string;
}

export class MerchantRevenueService {
  /**
   * Record daily revenue for a merchant.
   */
  async recordDay(merchantId: string, entry: RevenueEntry): Promise<void> {
    const key = `${REV_PREFIX}${merchantId}:${entry.date}`;
    try {
      const redis = getRedis();
      await redis.set(key, JSON.stringify(entry), { EX: REV_TTL });
    } catch (err) {
      log.warn('Failed to record revenue', { merchantId, date: entry.date, error: (err as Error).message });
    }
  }

  /**
   * Get revenue for a specific date.
   */
  async getDay(merchantId: string, date: string): Promise<RevenueEntry | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${REV_PREFIX}${merchantId}:${date}`);
      return raw ? JSON.parse(raw) as RevenueEntry : null;
    } catch {
      return null;
    }
  }

  /**
   * Generate a revenue report for a date range.
   */
  async generateReport(merchantId: string, startDate: string, endDate: string): Promise<RevenueReport> {
    const entries: RevenueEntry[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    const dayMs = 24 * 60 * 60 * 1000;
    const dayCount = Math.min(Math.ceil((end.getTime() - start.getTime()) / dayMs) + 1, 180);

    for (let i = 0; i < dayCount; i++) {
      const d = new Date(start.getTime() + i * dayMs);
      const dateStr = d.toISOString().slice(0, 10);
      const entry = await this.getDay(merchantId, dateStr);
      if (entry) entries.push(entry);
    }

    const totals = entries.reduce(
      (acc, e) => ({
        transactionCount: acc.transactionCount + e.transactionCount,
        grossVolume: acc.grossVolume + e.grossVolume,
        fees: acc.fees + e.fees,
        netRevenue: acc.netRevenue + e.netRevenue,
        refunds: acc.refunds + e.refunds,
        avgTicket: 0,
      }),
      { transactionCount: 0, grossVolume: 0, fees: 0, netRevenue: 0, refunds: 0, avgTicket: 0 },
    );
    totals.avgTicket = totals.transactionCount > 0 ? Math.round(totals.grossVolume / totals.transactionCount) : 0;

    const period: RevenuePeriod = dayCount === 1 ? 'TODAY' : dayCount <= 7 ? 'WEEK' : dayCount <= 31 ? 'MONTH' : 'CUSTOM';

    return {
      merchantId,
      period,
      startDate,
      endDate,
      entries,
      totals,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Format a revenue report summary.
   */
  formatReportSummary(report: RevenueReport): string {
    const { totals } = report;
    return [
      `Periodo: ${report.startDate} a ${report.endDate}`,
      `Transacciones: ${totals.transactionCount}`,
      `Volumen bruto: ${formatCLP(totals.grossVolume)}`,
      `Comisiones: ${formatCLP(totals.fees)}`,
      `Ingreso neto: ${formatCLP(totals.netRevenue)}`,
      `Reembolsos: ${formatCLP(totals.refunds)}`,
      `Ticket promedio: ${formatCLP(totals.avgTicket)}`,
    ].join('\n');
  }

  /**
   * Compare two periods (growth metrics).
   */
  comparePeriods(current: RevenueReport, previous: RevenueReport): {
    volumeGrowth: number;
    txGrowth: number;
    revenueGrowth: number;
    avgTicketGrowth: number;
  } {
    const pct = (a: number, b: number) => b === 0 ? 0 : Math.round(((a - b) / b) * 100);
    return {
      volumeGrowth: pct(current.totals.grossVolume, previous.totals.grossVolume),
      txGrowth: pct(current.totals.transactionCount, previous.totals.transactionCount),
      revenueGrowth: pct(current.totals.netRevenue, previous.totals.netRevenue),
      avgTicketGrowth: pct(current.totals.avgTicket, previous.totals.avgTicket),
    };
  }
}

export const merchantRevenue = new MerchantRevenueService();
