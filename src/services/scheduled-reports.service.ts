import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { randomBytes } from 'crypto';

const log = createLogger('scheduled-reports');

// ─── Types ──────────────────────────────────────────────

export type ReportFrequency = 'daily' | 'weekly' | 'monthly';
export type ReportType = 'transactions' | 'revenue' | 'users' | 'disputes' | 'compliance';
export type ReportFormat = 'csv' | 'json' | 'summary';

export interface ScheduledReport {
  id: string;
  merchantId: string;
  name: string;
  type: ReportType;
  frequency: ReportFrequency;
  format: ReportFormat;
  recipients: string[];        // email addresses
  filters: Record<string, string>;
  active: boolean;
  lastRunAt: string | null;
  nextRunAt: string;
  createdAt: string;
}

export interface ReportExecution {
  id: string;
  reportId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt: string;
  completedAt: string | null;
  rowCount: number;
  error: string | null;
}

const REPORTS_PREFIX = 'reports:';
const MERCHANT_INDEX = 'reports:merchant:';
const EXECUTIONS_PREFIX = 'reports:exec:';
const REPORTS_TTL = 365 * 24 * 60 * 60;

const VALID_TYPES: ReportType[] = ['transactions', 'revenue', 'users', 'disputes', 'compliance'];
const VALID_FREQUENCIES: ReportFrequency[] = ['daily', 'weekly', 'monthly'];
const VALID_FORMATS: ReportFormat[] = ['csv', 'json', 'summary'];

// ─── Service ────────────────────────────────────────────

export class ScheduledReportsService {
  /**
   * Create a scheduled report.
   */
  async createReport(input: {
    merchantId: string;
    name: string;
    type: ReportType;
    frequency: ReportFrequency;
    format?: ReportFormat;
    recipients: string[];
    filters?: Record<string, string>;
  }): Promise<ScheduledReport> {
    if (!input.name || input.name.length > 100) {
      throw new Error('Nombre debe tener entre 1 y 100 caracteres');
    }
    if (!VALID_TYPES.includes(input.type)) {
      throw new Error(`Tipo inválido: ${input.type}`);
    }
    if (!VALID_FREQUENCIES.includes(input.frequency)) {
      throw new Error(`Frecuencia inválida: ${input.frequency}`);
    }
    if (input.format && !VALID_FORMATS.includes(input.format)) {
      throw new Error(`Formato inválido: ${input.format}`);
    }
    if (!input.recipients.length || input.recipients.length > 10) {
      throw new Error('Debe incluir entre 1 y 10 destinatarios');
    }
    for (const email of input.recipients) {
      if (!email.includes('@') || email.length > 254) {
        throw new Error(`Email inválido: ${email}`);
      }
    }

    const nextRunAt = this.calculateNextRun(input.frequency);
    const report: ScheduledReport = {
      id: `rpt_${randomBytes(8).toString('hex')}`,
      merchantId: input.merchantId,
      name: input.name,
      type: input.type,
      frequency: input.frequency,
      format: input.format ?? 'csv',
      recipients: input.recipients,
      filters: input.filters ?? {},
      active: true,
      lastRunAt: null,
      nextRunAt,
      createdAt: new Date().toISOString(),
    };

    try {
      const redis = getRedis();
      await redis.set(`${REPORTS_PREFIX}${report.id}`, JSON.stringify(report), { EX: REPORTS_TTL });

      // Merchant index
      const idxKey = `${MERCHANT_INDEX}${input.merchantId}`;
      const idxRaw = await redis.get(idxKey);
      const idx: string[] = idxRaw ? JSON.parse(idxRaw) : [];
      idx.push(report.id);
      await redis.set(idxKey, JSON.stringify(idx), { EX: REPORTS_TTL });

      log.info('Report scheduled', { id: report.id, type: report.type, frequency: report.frequency });
    } catch (err) {
      log.warn('Failed to save scheduled report', { error: (err as Error).message });
    }

    return report;
  }

  /**
   * Get a report by ID.
   */
  async getReport(reportId: string): Promise<ScheduledReport | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${REPORTS_PREFIX}${reportId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * List reports for a merchant.
   */
  async getMerchantReports(merchantId: string): Promise<ScheduledReport[]> {
    try {
      const redis = getRedis();
      const idxRaw = await redis.get(`${MERCHANT_INDEX}${merchantId}`);
      if (!idxRaw) return [];

      const ids: string[] = JSON.parse(idxRaw);
      const reports: ScheduledReport[] = [];

      for (const id of ids) {
        const raw = await redis.get(`${REPORTS_PREFIX}${id}`);
        if (raw) reports.push(JSON.parse(raw));
      }

      return reports;
    } catch {
      return [];
    }
  }

  /**
   * Update a report's configuration.
   */
  async updateReport(
    reportId: string,
    updates: { name?: string; frequency?: ReportFrequency; recipients?: string[]; active?: boolean },
  ): Promise<ScheduledReport | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${REPORTS_PREFIX}${reportId}`);
      if (!raw) return null;

      const report: ScheduledReport = JSON.parse(raw);

      if (updates.name !== undefined) {
        if (!updates.name || updates.name.length > 100) throw new Error('Nombre inválido');
        report.name = updates.name;
      }
      if (updates.frequency !== undefined) {
        if (!VALID_FREQUENCIES.includes(updates.frequency)) throw new Error('Frecuencia inválida');
        report.frequency = updates.frequency;
        report.nextRunAt = this.calculateNextRun(updates.frequency);
      }
      if (updates.recipients !== undefined) {
        if (!updates.recipients.length || updates.recipients.length > 10) {
          throw new Error('Destinatarios inválidos');
        }
        report.recipients = updates.recipients;
      }
      if (updates.active !== undefined) {
        report.active = updates.active;
      }

      await redis.set(`${REPORTS_PREFIX}${reportId}`, JSON.stringify(report), { EX: REPORTS_TTL });
      return report;
    } catch (err) {
      if ((err as Error).message.includes('Nombre') ||
          (err as Error).message.includes('Frecuencia') ||
          (err as Error).message.includes('Destinatarios')) {
        throw err;
      }
      return null;
    }
  }

  /**
   * Record a report execution.
   */
  async recordExecution(
    reportId: string,
    status: 'completed' | 'failed',
    rowCount = 0,
    error: string | null = null,
  ): Promise<ReportExecution> {
    const execution: ReportExecution = {
      id: `exec_${randomBytes(8).toString('hex')}`,
      reportId,
      status,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      rowCount,
      error,
    };

    try {
      const redis = getRedis();

      // Save execution
      const execKey = `${EXECUTIONS_PREFIX}${reportId}`;
      const execRaw = await redis.get(execKey);
      const executions: ReportExecution[] = execRaw ? JSON.parse(execRaw) : [];
      executions.push(execution);
      const trimmed = executions.slice(-50); // Keep last 50
      await redis.set(execKey, JSON.stringify(trimmed), { EX: REPORTS_TTL });

      // Update report's lastRunAt and nextRunAt
      const reportRaw = await redis.get(`${REPORTS_PREFIX}${reportId}`);
      if (reportRaw) {
        const report: ScheduledReport = JSON.parse(reportRaw);
        report.lastRunAt = new Date().toISOString();
        report.nextRunAt = this.calculateNextRun(report.frequency);
        await redis.set(`${REPORTS_PREFIX}${reportId}`, JSON.stringify(report), { EX: REPORTS_TTL });
      }
    } catch (err) {
      log.warn('Failed to record execution', { reportId, error: (err as Error).message });
    }

    return execution;
  }

  /**
   * Get execution history for a report.
   */
  async getExecutions(reportId: string): Promise<ReportExecution[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${EXECUTIONS_PREFIX}${reportId}`);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  /**
   * Get all reports that are due for execution.
   */
  async getDueReports(): Promise<ScheduledReport[]> {
    try {
      const reports = await this.getAllActiveReports();
      const now = new Date().toISOString();
      return reports.filter((r) => r.active && r.nextRunAt <= now);
    } catch {
      return [];
    }
  }

  /**
   * Delete a report.
   */
  async deleteReport(reportId: string): Promise<boolean> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${REPORTS_PREFIX}${reportId}`);
      if (!raw) return false;

      const report: ScheduledReport = JSON.parse(raw);
      await redis.del(`${REPORTS_PREFIX}${reportId}`);
      await redis.del(`${EXECUTIONS_PREFIX}${reportId}`);

      // Remove from merchant index
      const idxKey = `${MERCHANT_INDEX}${report.merchantId}`;
      const idxRaw = await redis.get(idxKey);
      if (idxRaw) {
        const ids: string[] = JSON.parse(idxRaw);
        const updated = ids.filter((id) => id !== reportId);
        await redis.set(idxKey, JSON.stringify(updated), { EX: REPORTS_TTL });
      }

      return true;
    } catch {
      return false;
    }
  }

  // ─── Helpers ────────────────────────────────────────────

  calculateNextRun(frequency: ReportFrequency): string {
    const now = new Date();
    switch (frequency) {
      case 'daily':
        now.setDate(now.getDate() + 1);
        now.setHours(6, 0, 0, 0); // 6 AM
        break;
      case 'weekly':
        now.setDate(now.getDate() + (8 - now.getDay()) % 7 || 7); // Next Monday
        now.setHours(6, 0, 0, 0);
        break;
      case 'monthly':
        now.setMonth(now.getMonth() + 1, 1); // 1st of next month
        now.setHours(6, 0, 0, 0);
        break;
    }
    return now.toISOString();
  }

  private async getAllActiveReports(): Promise<ScheduledReport[]> {
    // Simplified: get from a global active reports index
    try {
      const redis = getRedis();
      const raw = await redis.get('reports:active');
      if (!raw) return [];
      const ids: string[] = JSON.parse(raw);
      const reports: ScheduledReport[] = [];
      for (const id of ids) {
        const r = await redis.get(`${REPORTS_PREFIX}${id}`);
        if (r) reports.push(JSON.parse(r));
      }
      return reports;
    } catch {
      return [];
    }
  }
}

export const scheduledReports = new ScheduledReportsService();
