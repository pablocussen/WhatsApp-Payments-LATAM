import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { randomBytes } from 'crypto';

const log = createLogger('tx-export');

// ─── Types ──────────────────────────────────────────────

export type ExportFormat = 'csv' | 'json' | 'summary';
export type ExportStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface ExportFilter {
  userId?: string;
  merchantId?: string;
  status?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  minAmount?: number;
  maxAmount?: number;
}

export interface ExportJob {
  id: string;
  requestedBy: string;
  format: ExportFormat;
  filters: ExportFilter;
  status: ExportStatus;
  totalRecords: number;
  fileUrl: string | null;
  fileSize: number | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
  expiresAt: string;
}

export interface ExportColumn {
  key: string;
  label: string;
  format?: 'currency' | 'date' | 'status';
}

export interface TransactionRow {
  id: string;
  date: string;
  type: string;
  status: string;
  amount: number;
  fee: number;
  net: number;
  from: string;
  to: string;
  reference: string;
  description: string;
}

const JOB_PREFIX = 'export:job:';
const USER_JOBS = 'export:user-jobs:';
const JOB_TTL = 7 * 24 * 60 * 60; // 7 days

const DEFAULT_COLUMNS: ExportColumn[] = [
  { key: 'id', label: 'ID' },
  { key: 'date', label: 'Fecha', format: 'date' },
  { key: 'type', label: 'Tipo' },
  { key: 'status', label: 'Estado', format: 'status' },
  { key: 'amount', label: 'Monto', format: 'currency' },
  { key: 'fee', label: 'Comisión', format: 'currency' },
  { key: 'net', label: 'Neto', format: 'currency' },
  { key: 'from', label: 'Origen' },
  { key: 'to', label: 'Destino' },
  { key: 'reference', label: 'Referencia' },
  { key: 'description', label: 'Descripción' },
];

// ─── Service ────────────────────────────────────────────

export class TransactionExportService {
  /**
   * Create a new export job.
   */
  async createExportJob(input: {
    requestedBy: string;
    format: ExportFormat;
    filters?: ExportFilter;
  }): Promise<ExportJob> {
    if (!input.requestedBy) throw new Error('requestedBy requerido');
    if (!['csv', 'json', 'summary'].includes(input.format)) {
      throw new Error(`Formato inválido: ${input.format}`);
    }

    if (input.filters?.dateFrom && input.filters?.dateTo) {
      if (input.filters.dateFrom > input.filters.dateTo) {
        throw new Error('Fecha inicio no puede ser posterior a fecha fin');
      }
    }
    if (input.filters?.minAmount !== undefined && input.filters.minAmount < 0) {
      throw new Error('Monto mínimo no puede ser negativo');
    }
    if (input.filters?.maxAmount !== undefined && input.filters?.minAmount !== undefined) {
      if (input.filters.maxAmount < input.filters.minAmount) {
        throw new Error('Monto máximo no puede ser menor que monto mínimo');
      }
    }

    const now = new Date();
    const expires = new Date(now);
    expires.setDate(expires.getDate() + 7);

    const job: ExportJob = {
      id: `exp_${randomBytes(8).toString('hex')}`,
      requestedBy: input.requestedBy,
      format: input.format,
      filters: input.filters ?? {},
      status: 'pending',
      totalRecords: 0,
      fileUrl: null,
      fileSize: null,
      errorMessage: null,
      createdAt: now.toISOString(),
      completedAt: null,
      expiresAt: expires.toISOString(),
    };

    try {
      const redis = getRedis();
      await redis.set(`${JOB_PREFIX}${job.id}`, JSON.stringify(job), { EX: JOB_TTL });

      // Add to user's job list
      const listKey = `${USER_JOBS}${input.requestedBy}`;
      const listRaw = await redis.get(listKey);
      const list: string[] = listRaw ? JSON.parse(listRaw) : [];
      list.push(job.id);
      // Keep last 50 jobs
      if (list.length > 50) list.splice(0, list.length - 50);
      await redis.set(listKey, JSON.stringify(list), { EX: JOB_TTL });

      log.info('Export job created', { id: job.id, format: input.format, requestedBy: input.requestedBy });
    } catch (err) {
      log.warn('Failed to save export job', { error: (err as Error).message });
    }

    return job;
  }

  /**
   * Get an export job by ID.
   */
  async getExportJob(jobId: string): Promise<ExportJob | null> { return this.getJob(jobId); }

  async getJob(jobId: string): Promise<ExportJob | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${JOB_PREFIX}${jobId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * Get all export jobs for a user.
   */
  async getUserJobs(userId: string): Promise<ExportJob[]> {
    try {
      const redis = getRedis();
      const listRaw = await redis.get(`${USER_JOBS}${userId}`);
      if (!listRaw) return [];

      const ids: string[] = JSON.parse(listRaw);
      const jobs: ExportJob[] = [];

      for (const id of ids) {
        const raw = await redis.get(`${JOB_PREFIX}${id}`);
        if (raw) jobs.push(JSON.parse(raw));
      }

      return jobs;
    } catch {
      return [];
    }
  }

  /**
   * Complete an export job with results.
   */
  async completeJob(
    jobId: string,
    result: { totalRecords: number; fileUrl: string; fileSize: number },
  ): Promise<ExportJob | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${JOB_PREFIX}${jobId}`);
      if (!raw) return null;

      const job: ExportJob = JSON.parse(raw);
      if (job.status !== 'pending' && job.status !== 'processing') {
        throw new Error(`No se puede completar job en estado ${job.status}`);
      }

      job.status = 'completed';
      job.totalRecords = result.totalRecords;
      job.fileUrl = result.fileUrl;
      job.fileSize = result.fileSize;
      job.completedAt = new Date().toISOString();

      await redis.set(`${JOB_PREFIX}${jobId}`, JSON.stringify(job), { EX: JOB_TTL });
      log.info('Export job completed', { id: jobId, records: result.totalRecords });
      return job;
    } catch (err) {
      if ((err as Error).message.includes('No se puede')) throw err;
      return null;
    }
  }

  /**
   * Fail an export job.
   */
  async failJob(jobId: string, errorMessage: string): Promise<ExportJob | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${JOB_PREFIX}${jobId}`);
      if (!raw) return null;

      const job: ExportJob = JSON.parse(raw);
      job.status = 'failed';
      job.errorMessage = errorMessage;
      job.completedAt = new Date().toISOString();

      await redis.set(`${JOB_PREFIX}${jobId}`, JSON.stringify(job), { EX: JOB_TTL });
      log.warn('Export job failed', { id: jobId, error: errorMessage });
      return job;
    } catch {
      return null;
    }
  }

  /**
   * Generate CSV from transaction rows.
   */
  generateCsv(
    rows: TransactionRow[],
    columns?: ExportColumn[],
  ): string {
    const cols = columns ?? DEFAULT_COLUMNS;
    const header = cols.map((c) => this.escapeCsvField(c.label)).join(',');

    const lines = rows.map((row) => {
      return cols.map((col) => {
        const value = (row as unknown as Record<string, unknown>)[col.key];
        if (value === null || value === undefined) return '';
        if (col.format === 'currency' && typeof value === 'number') {
          return this.escapeCsvField(this.formatCurrency(value));
        }
        return this.escapeCsvField(String(value));
      }).join(',');
    });

    return [header, ...lines].join('\n');
  }

  /**
   * Generate JSON export from transaction rows.
   */
  generateJson(rows: TransactionRow[]): string {
    return JSON.stringify({
      exportedAt: new Date().toISOString(),
      count: rows.length,
      transactions: rows,
    }, null, 2);
  }

  /**
   * Generate summary from transaction rows.
   */
  generateSummary(rows: TransactionRow[]): {
    totalTransactions: number;
    totalAmount: number;
    totalFees: number;
    totalNet: number;
    byType: Record<string, { count: number; amount: number }>;
    byStatus: Record<string, { count: number; amount: number }>;
  } {
    const byType: Record<string, { count: number; amount: number }> = {};
    const byStatus: Record<string, { count: number; amount: number }> = {};

    for (const row of rows) {
      if (!byType[row.type]) byType[row.type] = { count: 0, amount: 0 };
      byType[row.type].count += 1;
      byType[row.type].amount += row.amount;

      if (!byStatus[row.status]) byStatus[row.status] = { count: 0, amount: 0 };
      byStatus[row.status].count += 1;
      byStatus[row.status].amount += row.amount;
    }

    return {
      totalTransactions: rows.length,
      totalAmount: rows.reduce((sum, r) => sum + r.amount, 0),
      totalFees: rows.reduce((sum, r) => sum + r.fee, 0),
      totalNet: rows.reduce((sum, r) => sum + r.net, 0),
      byType,
      byStatus,
    };
  }

  /**
   * Filter transaction rows.
   */
  filterRows(rows: TransactionRow[], filters: ExportFilter): TransactionRow[] {
    return rows.filter((row) => {
      if (filters.status && row.status !== filters.status) return false;
      if (filters.type && row.type !== filters.type) return false;
      if (filters.dateFrom && row.date < filters.dateFrom) return false;
      if (filters.dateTo && row.date > filters.dateTo) return false;
      if (filters.minAmount !== undefined && row.amount < filters.minAmount) return false;
      if (filters.maxAmount !== undefined && row.amount > filters.maxAmount) return false;
      return true;
    });
  }

  /**
   * Get available export columns.
   */
  getColumns(): ExportColumn[] {
    return [...DEFAULT_COLUMNS];
  }

  // ─── Helpers ────────────────────────────────────────────

  private escapeCsvField(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }

  private formatCurrency(amount: number): string {
    return `$${amount.toLocaleString('es-CL')}`;
  }
}

export const transactionExport = new TransactionExportService();
