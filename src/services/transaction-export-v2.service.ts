import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('tx-export-v2');

export type ExportFormat = 'CSV' | 'JSON' | 'PDF_DATA';

export interface ExportRequest {
  id: string;
  merchantId: string;
  format: ExportFormat;
  dateFrom: string;
  dateTo: string;
  filters: { status?: string; minAmount?: number; maxAmount?: number };
  rowCount: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  downloadUrl: string | null;
  createdAt: string;
  completedAt: string | null;
}

export class TransactionExportV2Service {
  async requestExport(input: { merchantId: string; format: ExportFormat; dateFrom: string; dateTo: string; filters?: ExportRequest['filters'] }): Promise<ExportRequest> {
    if (!['CSV', 'JSON', 'PDF_DATA'].includes(input.format)) throw new Error('Formato inválido.');
    const from = new Date(input.dateFrom);
    const to = new Date(input.dateTo);
    if (from > to) throw new Error('Fecha inicio debe ser anterior a fecha fin.');
    const diffDays = (to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
    if (diffDays > 365) throw new Error('Rango máximo: 365 días.');

    const request: ExportRequest = {
      id: `exp_${Date.now().toString(36)}`, merchantId: input.merchantId,
      format: input.format, dateFrom: input.dateFrom, dateTo: input.dateTo,
      filters: input.filters ?? {}, rowCount: 0,
      status: 'PENDING', downloadUrl: null,
      createdAt: new Date().toISOString(), completedAt: null,
    };
    try { const redis = getRedis(); await redis.set(`txexp:${request.id}`, JSON.stringify(request), { EX: 7 * 24 * 60 * 60 }); }
    catch (err) { log.warn('Failed to save export', { error: (err as Error).message }); }
    log.info('Export requested', { exportId: request.id, format: input.format });
    return request;
  }

  async getExport(exportId: string): Promise<ExportRequest | null> {
    try { const redis = getRedis(); const raw = await redis.get(`txexp:${exportId}`); return raw ? JSON.parse(raw) as ExportRequest : null; }
    catch { return null; }
  }

  async markCompleted(exportId: string, rowCount: number, downloadUrl: string): Promise<boolean> {
    const exp = await this.getExport(exportId);
    if (!exp) return false;
    exp.status = 'COMPLETED'; exp.rowCount = rowCount; exp.downloadUrl = downloadUrl;
    exp.completedAt = new Date().toISOString();
    try { const redis = getRedis(); await redis.set(`txexp:${exportId}`, JSON.stringify(exp), { EX: 7 * 24 * 60 * 60 }); }
    catch { return false; }
    return true;
  }

  generateCSVHeader(): string {
    return 'Referencia,Fecha,Tipo,Monto,Comisión,Neto,Estado,Contraparte,Descripción,Método';
  }

  formatExportRow(data: { ref: string; date: string; type: string; amount: number; fee: number; net: number; status: string; counterparty: string; description: string; method: string }): string {
    return `${data.ref},${data.date},${data.type},${formatCLP(data.amount)},${formatCLP(data.fee)},${formatCLP(data.net)},${data.status},${data.counterparty},"${data.description}",${data.method}`;
  }
}

export const transactionExportV2 = new TransactionExportV2Service();
