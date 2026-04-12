import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('tax-record');
const TR_PREFIX = 'mtaxrec:';
const TR_TTL = 365 * 24 * 60 * 60;

export interface TaxRecord {
  id: string;
  merchantId: string;
  transactionRef: string;
  subtotal: number;
  ivaAmount: number;
  total: number;
  isExempt: boolean;
  category: string | null;
  documentType: 'BOLETA' | 'FACTURA';
  documentNumber: string | null;
  recordedAt: string;
}

export interface MonthlyTaxSummary {
  period: string;
  totalTransactions: number;
  totalSubtotal: number;
  totalIVA: number;
  totalExempt: number;
  netToDeclare: number;
}

export class MerchantTaxRecordService {
  async recordTransaction(input: Omit<TaxRecord, 'id' | 'recordedAt'>): Promise<TaxRecord> {
    const record: TaxRecord = { ...input, id: `txrec_${Date.now().toString(36)}`, recordedAt: new Date().toISOString() };
    const period = record.recordedAt.slice(0, 7);
    try {
      const redis = getRedis();
      await redis.lPush(`${TR_PREFIX}${input.merchantId}:${period}`, JSON.stringify(record));
      await redis.expire(`${TR_PREFIX}${input.merchantId}:${period}`, TR_TTL);
    } catch (err) { log.warn('Failed to record tax transaction', { error: (err as Error).message }); }
    return record;
  }

  async getMonthlyRecords(merchantId: string, period: string): Promise<TaxRecord[]> {
    try {
      const redis = getRedis();
      const raw = await redis.lRange(`${TR_PREFIX}${merchantId}:${period}`, 0, -1);
      return raw.map(r => JSON.parse(r) as TaxRecord);
    } catch { return []; }
  }

  async getMonthlySummary(merchantId: string, period: string): Promise<MonthlyTaxSummary> {
    const records = await this.getMonthlyRecords(merchantId, period);
    const totalSubtotal = records.reduce((s, r) => s + r.subtotal, 0);
    const totalIVA = records.reduce((s, r) => s + r.ivaAmount, 0);
    const totalExempt = records.filter(r => r.isExempt).reduce((s, r) => s + r.subtotal, 0);
    return {
      period,
      totalTransactions: records.length,
      totalSubtotal,
      totalIVA,
      totalExempt,
      netToDeclare: totalIVA,
    };
  }

  formatSummary(s: MonthlyTaxSummary): string {
    return [
      `Periodo: ${s.period}`,
      `Transacciones: ${s.totalTransactions}`,
      `Subtotal: ${formatCLP(s.totalSubtotal)}`,
      `IVA recaudado: ${formatCLP(s.totalIVA)}`,
      `Exento: ${formatCLP(s.totalExempt)}`,
      `A declarar: ${formatCLP(s.netToDeclare)}`,
    ].join(' | ');
  }
}

export const merchantTaxRecord = new MerchantTaxRecordService();
