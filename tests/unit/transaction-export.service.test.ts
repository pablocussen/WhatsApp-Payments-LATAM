/**
 * Unit tests for TransactionExportService.
 * Redis is fully mocked.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test' },
}));

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  }),
}));

import { TransactionExportService } from '../../src/services/transaction-export.service';
import type { ExportJob, TransactionRow } from '../../src/services/transaction-export.service';

describe('TransactionExportService', () => {
  let svc: TransactionExportService;

  beforeEach(() => {
    svc = new TransactionExportService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
  });

  const sampleRows: TransactionRow[] = [
    { id: 'tx_1', date: '2026-03-01', type: 'P2P', status: 'COMPLETED', amount: 10000, fee: 0, net: 10000, from: '+56912345678', to: '+56987654321', reference: 'WP-ABC123', description: 'Pago almuerzo' },
    { id: 'tx_2', date: '2026-03-02', type: 'TOPUP', status: 'COMPLETED', amount: 50000, fee: 1400, net: 48600, from: 'WebPay', to: '+56912345678', reference: 'WP-DEF456', description: 'Recarga WebPay' },
    { id: 'tx_3', date: '2026-03-03', type: 'P2P', status: 'FAILED', amount: 5000, fee: 0, net: 5000, from: '+56912345678', to: '+56911111111', reference: 'WP-GHI789', description: 'Pago fallido' },
  ];

  // ─── createExportJob ────────────────────────────────────

  describe('createExportJob', () => {
    it('creates job with exp_ prefix', async () => {
      const job = await svc.createExportJob({ requestedBy: 'u1', format: 'csv' });
      expect(job.id).toMatch(/^exp_[0-9a-f]{16}$/);
      expect(job.requestedBy).toBe('u1');
      expect(job.format).toBe('csv');
      expect(job.status).toBe('pending');
      expect(job.totalRecords).toBe(0);
      expect(job.fileUrl).toBeNull();
    });

    it('accepts filters', async () => {
      const job = await svc.createExportJob({
        requestedBy: 'u1', format: 'json',
        filters: { status: 'COMPLETED', dateFrom: '2026-03-01', dateTo: '2026-03-31' },
      });
      expect(job.filters.status).toBe('COMPLETED');
      expect(job.filters.dateFrom).toBe('2026-03-01');
    });

    it('sets 7-day expiry', async () => {
      const job = await svc.createExportJob({ requestedBy: 'u1', format: 'csv' });
      const created = new Date(job.createdAt);
      const expires = new Date(job.expiresAt);
      const diffDays = (expires.getTime() - created.getTime()) / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeCloseTo(7, 0);
    });

    it('saves to Redis', async () => {
      await svc.createExportJob({ requestedBy: 'u1', format: 'csv' });
      expect(mockRedisSet).toHaveBeenCalledWith(
        expect.stringMatching(/^export:job:exp_/),
        expect.any(String),
        { EX: 7 * 24 * 60 * 60 },
      );
    });

    it('rejects empty requestedBy', async () => {
      await expect(svc.createExportJob({ requestedBy: '', format: 'csv' }))
        .rejects.toThrow('requestedBy');
    });

    it('rejects invalid format', async () => {
      await expect(svc.createExportJob({ requestedBy: 'u1', format: 'xml' as any }))
        .rejects.toThrow('inválido');
    });

    it('rejects dateFrom after dateTo', async () => {
      await expect(svc.createExportJob({
        requestedBy: 'u1', format: 'csv',
        filters: { dateFrom: '2026-03-31', dateTo: '2026-03-01' },
      })).rejects.toThrow('posterior');
    });

    it('rejects negative minAmount', async () => {
      await expect(svc.createExportJob({
        requestedBy: 'u1', format: 'csv',
        filters: { minAmount: -1 },
      })).rejects.toThrow('negativo');
    });

    it('rejects maxAmount less than minAmount', async () => {
      await expect(svc.createExportJob({
        requestedBy: 'u1', format: 'csv',
        filters: { minAmount: 5000, maxAmount: 1000 },
      })).rejects.toThrow('menor');
    });

    it('does not throw on Redis error', async () => {
      mockRedisSet.mockRejectedValue(new Error('Redis down'));
      const job = await svc.createExportJob({ requestedBy: 'u1', format: 'csv' });
      expect(job.id).toBeDefined();
    });
  });

  // ─── getJob ─────────────────────────────────────────────

  describe('getJob', () => {
    it('returns stored job', async () => {
      const job: ExportJob = {
        id: 'exp_abc', requestedBy: 'u1', format: 'csv', filters: {},
        status: 'completed', totalRecords: 100, fileUrl: 'gs://b/f.csv',
        fileSize: 5000, errorMessage: null, createdAt: '2026-03-01',
        completedAt: '2026-03-01', expiresAt: '2026-03-08',
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(job));
      const result = await svc.getJob('exp_abc');
      expect(result).not.toBeNull();
      expect(result!.totalRecords).toBe(100);
    });

    it('returns null when not found', async () => {
      expect(await svc.getJob('exp_unknown')).toBeNull();
    });

    it('returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.getJob('exp_abc')).toBeNull();
    });
  });

  // ─── getUserJobs ────────────────────────────────────────

  describe('getUserJobs', () => {
    it('returns user jobs', async () => {
      const job: ExportJob = {
        id: 'exp_1', requestedBy: 'u1', format: 'csv', filters: {},
        status: 'completed', totalRecords: 50, fileUrl: 'gs://b/f.csv',
        fileSize: 2000, errorMessage: null, createdAt: '2026-03-01',
        completedAt: '2026-03-01', expiresAt: '2026-03-08',
      };
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'export:user-jobs:u1') return Promise.resolve(JSON.stringify(['exp_1']));
        if (key === 'export:job:exp_1') return Promise.resolve(JSON.stringify(job));
        return Promise.resolve(null);
      });

      const result = await svc.getUserJobs('u1');
      expect(result).toHaveLength(1);
    });

    it('returns empty when none', async () => {
      expect(await svc.getUserJobs('u-none')).toEqual([]);
    });

    it('returns empty on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.getUserJobs('u1')).toEqual([]);
    });
  });

  // ─── completeJob ────────────────────────────────────────

  describe('completeJob', () => {
    const pendingJob: ExportJob = {
      id: 'exp_p1', requestedBy: 'u1', format: 'csv', filters: {},
      status: 'pending', totalRecords: 0, fileUrl: null,
      fileSize: null, errorMessage: null, createdAt: '2026-03-01',
      completedAt: null, expiresAt: '2026-03-08',
    };

    it('completes a pending job', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(pendingJob));
      const result = await svc.completeJob('exp_p1', {
        totalRecords: 150, fileUrl: 'gs://bucket/export.csv', fileSize: 8500,
      });
      expect(result).not.toBeNull();
      expect(result!.status).toBe('completed');
      expect(result!.totalRecords).toBe(150);
      expect(result!.fileUrl).toBe('gs://bucket/export.csv');
      expect(result!.completedAt).not.toBeNull();
    });

    it('completes a processing job', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ ...pendingJob, status: 'processing' }));
      const result = await svc.completeJob('exp_p1', {
        totalRecords: 10, fileUrl: 'gs://b/f.csv', fileSize: 500,
      });
      expect(result!.status).toBe('completed');
    });

    it('throws when already completed', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ ...pendingJob, status: 'completed' }));
      await expect(svc.completeJob('exp_p1', {
        totalRecords: 10, fileUrl: 'gs://b/f.csv', fileSize: 500,
      })).rejects.toThrow('No se puede completar');
    });

    it('returns null for unknown job', async () => {
      expect(await svc.completeJob('exp_unknown', {
        totalRecords: 0, fileUrl: '', fileSize: 0,
      })).toBeNull();
    });

    it('returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.completeJob('exp_1', {
        totalRecords: 0, fileUrl: '', fileSize: 0,
      })).toBeNull();
    });
  });

  // ─── failJob ────────────────────────────────────────────

  describe('failJob', () => {
    it('marks job as failed', async () => {
      const job: ExportJob = {
        id: 'exp_f1', requestedBy: 'u1', format: 'csv', filters: {},
        status: 'processing', totalRecords: 0, fileUrl: null,
        fileSize: null, errorMessage: null, createdAt: '2026-03-01',
        completedAt: null, expiresAt: '2026-03-08',
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(job));
      const result = await svc.failJob('exp_f1', 'Timeout exceeded');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('failed');
      expect(result!.errorMessage).toBe('Timeout exceeded');
    });

    it('returns null for unknown job', async () => {
      expect(await svc.failJob('exp_unknown', 'error')).toBeNull();
    });

    it('returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.failJob('exp_1', 'error')).toBeNull();
    });
  });

  // ─── generateCsv ───────────────────────────────────────

  describe('generateCsv', () => {
    it('generates CSV with headers', () => {
      const csv = svc.generateCsv(sampleRows);
      const lines = csv.split('\n');
      expect(lines[0]).toContain('ID');
      expect(lines[0]).toContain('Monto');
      expect(lines).toHaveLength(4); // header + 3 rows
    });

    it('formats currency columns', () => {
      const csv = svc.generateCsv(sampleRows);
      expect(csv).toContain('$');
    });

    it('escapes commas in fields', () => {
      const rows: TransactionRow[] = [{
        id: 'tx_1', date: '2026-03-01', type: 'P2P', status: 'COMPLETED',
        amount: 10000, fee: 0, net: 10000, from: '+56912345678',
        to: '+56987654321', reference: 'WP-1', description: 'Pago, con coma',
      }];
      const csv = svc.generateCsv(rows);
      expect(csv).toContain('"Pago, con coma"');
    });

    it('escapes quotes in fields', () => {
      const rows: TransactionRow[] = [{
        id: 'tx_1', date: '2026-03-01', type: 'P2P', status: 'COMPLETED',
        amount: 10000, fee: 0, net: 10000, from: '+56912345678',
        to: '+56987654321', reference: 'WP-1', description: 'Pago "especial"',
      }];
      const csv = svc.generateCsv(rows);
      expect(csv).toContain('"Pago ""especial"""');
    });

    it('uses custom columns', () => {
      const csv = svc.generateCsv(sampleRows, [
        { key: 'id', label: 'TransID' },
        { key: 'amount', label: 'Amount', format: 'currency' },
      ]);
      const lines = csv.split('\n');
      expect(lines[0]).toBe('TransID,Amount');
      expect(lines).toHaveLength(4);
    });

    it('handles empty rows', () => {
      const csv = svc.generateCsv([]);
      const lines = csv.split('\n');
      expect(lines).toHaveLength(1); // just header
    });
  });

  // ─── generateJson ──────────────────────────────────────

  describe('generateJson', () => {
    it('generates valid JSON', () => {
      const json = svc.generateJson(sampleRows);
      const parsed = JSON.parse(json);
      expect(parsed.count).toBe(3);
      expect(parsed.transactions).toHaveLength(3);
      expect(parsed.exportedAt).toBeDefined();
    });

    it('handles empty rows', () => {
      const json = svc.generateJson([]);
      const parsed = JSON.parse(json);
      expect(parsed.count).toBe(0);
      expect(parsed.transactions).toEqual([]);
    });
  });

  // ─── generateSummary ───────────────────────────────────

  describe('generateSummary', () => {
    it('calculates totals', () => {
      const summary = svc.generateSummary(sampleRows);
      expect(summary.totalTransactions).toBe(3);
      expect(summary.totalAmount).toBe(65000);
      expect(summary.totalFees).toBe(1400);
      expect(summary.totalNet).toBe(63600);
    });

    it('groups by type', () => {
      const summary = svc.generateSummary(sampleRows);
      expect(summary.byType['P2P'].count).toBe(2);
      expect(summary.byType['TOPUP'].count).toBe(1);
    });

    it('groups by status', () => {
      const summary = svc.generateSummary(sampleRows);
      expect(summary.byStatus['COMPLETED'].count).toBe(2);
      expect(summary.byStatus['FAILED'].count).toBe(1);
    });

    it('handles empty rows', () => {
      const summary = svc.generateSummary([]);
      expect(summary.totalTransactions).toBe(0);
      expect(summary.totalAmount).toBe(0);
    });
  });

  // ─── filterRows ────────────────────────────────────────

  describe('filterRows', () => {
    it('filters by status', () => {
      const result = svc.filterRows(sampleRows, { status: 'COMPLETED' });
      expect(result).toHaveLength(2);
    });

    it('filters by type', () => {
      const result = svc.filterRows(sampleRows, { type: 'TOPUP' });
      expect(result).toHaveLength(1);
    });

    it('filters by date range', () => {
      const result = svc.filterRows(sampleRows, { dateFrom: '2026-03-02', dateTo: '2026-03-02' });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('tx_2');
    });

    it('filters by minAmount', () => {
      const result = svc.filterRows(sampleRows, { minAmount: 10000 });
      expect(result).toHaveLength(2);
    });

    it('filters by maxAmount', () => {
      const result = svc.filterRows(sampleRows, { maxAmount: 10000 });
      expect(result).toHaveLength(2);
    });

    it('combines multiple filters', () => {
      const result = svc.filterRows(sampleRows, { status: 'COMPLETED', type: 'P2P' });
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('tx_1');
    });

    it('returns all with empty filters', () => {
      const result = svc.filterRows(sampleRows, {});
      expect(result).toHaveLength(3);
    });
  });

  // ─── getColumns ────────────────────────────────────────

  describe('getColumns', () => {
    it('returns default columns', () => {
      const cols = svc.getColumns();
      expect(cols.length).toBeGreaterThan(0);
      expect(cols.find((c) => c.key === 'amount')?.format).toBe('currency');
      expect(cols.find((c) => c.key === 'date')?.format).toBe('date');
    });

    it('returns a copy', () => {
      const cols1 = svc.getColumns();
      const cols2 = svc.getColumns();
      expect(cols1).not.toBe(cols2);
    });
  });
});
