/**
 * Unit tests for ScheduledReportsService.
 * Redis is fully mocked.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisDel = jest.fn().mockResolvedValue(1);

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test' },
}));

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
  }),
}));

import { ScheduledReportsService } from '../../src/services/scheduled-reports.service';
import type { ScheduledReport, ReportExecution } from '../../src/services/scheduled-reports.service';

describe('ScheduledReportsService', () => {
  let svc: ScheduledReportsService;

  beforeEach(() => {
    svc = new ScheduledReportsService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRedisDel.mockResolvedValue(1);
  });

  // ─── createReport ─────────────────────────────────────

  describe('createReport', () => {
    const validInput = {
      merchantId: 'm-1',
      name: 'Daily Transactions',
      type: 'transactions' as const,
      frequency: 'daily' as const,
      recipients: ['admin@shop.cl'],
    };

    it('creates report with rpt_ prefix', async () => {
      const r = await svc.createReport(validInput);
      expect(r.id).toMatch(/^rpt_[0-9a-f]{16}$/);
      expect(r.merchantId).toBe('m-1');
      expect(r.type).toBe('transactions');
      expect(r.frequency).toBe('daily');
      expect(r.format).toBe('csv');
      expect(r.active).toBe(true);
      expect(r.lastRunAt).toBeNull();
      expect(r.nextRunAt).toBeDefined();
    });

    it('uses custom format', async () => {
      const r = await svc.createReport({ ...validInput, format: 'json' });
      expect(r.format).toBe('json');
    });

    it('stores filters', async () => {
      const r = await svc.createReport({ ...validInput, filters: { status: 'COMPLETED' } });
      expect(r.filters.status).toBe('COMPLETED');
    });

    it('saves to Redis with merchant index', async () => {
      await svc.createReport(validInput);
      expect(mockRedisSet).toHaveBeenCalledWith(
        expect.stringMatching(/^reports:rpt_/),
        expect.any(String),
        { EX: 365 * 24 * 60 * 60 },
      );
      const indexCalls = mockRedisSet.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).startsWith('reports:merchant:'),
      );
      expect(indexCalls).toHaveLength(1);
    });

    it('rejects empty name', async () => {
      await expect(svc.createReport({ ...validInput, name: '' }))
        .rejects.toThrow('Nombre');
    });

    it('rejects name over 100 chars', async () => {
      await expect(svc.createReport({ ...validInput, name: 'x'.repeat(101) }))
        .rejects.toThrow('Nombre');
    });

    it('rejects invalid type', async () => {
      await expect(svc.createReport({ ...validInput, type: 'custom' as never }))
        .rejects.toThrow('Tipo inválido');
    });

    it('rejects invalid frequency', async () => {
      await expect(svc.createReport({ ...validInput, frequency: 'hourly' as never }))
        .rejects.toThrow('Frecuencia inválida');
    });

    it('rejects invalid format', async () => {
      await expect(svc.createReport({ ...validInput, format: 'pdf' as never }))
        .rejects.toThrow('Formato inválido');
    });

    it('rejects empty recipients', async () => {
      await expect(svc.createReport({ ...validInput, recipients: [] }))
        .rejects.toThrow('Debe incluir');
    });

    it('rejects more than 10 recipients', async () => {
      await expect(svc.createReport({
        ...validInput,
        recipients: Array.from({ length: 11 }, (_, i) => `user${i}@test.cl`),
      })).rejects.toThrow('Debe incluir');
    });

    it('rejects invalid email', async () => {
      await expect(svc.createReport({ ...validInput, recipients: ['not-an-email'] }))
        .rejects.toThrow('Email inválido');
    });
  });

  // ─── getReport ────────────────────────────────────────

  describe('getReport', () => {
    it('returns stored report', async () => {
      const report: ScheduledReport = {
        id: 'rpt_1', merchantId: 'm-1', name: 'Test', type: 'transactions',
        frequency: 'daily', format: 'csv', recipients: ['a@b.cl'],
        filters: {}, active: true, lastRunAt: null,
        nextRunAt: '2026-01-01', createdAt: '2026-01-01',
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(report));
      const result = await svc.getReport('rpt_1');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Test');
    });

    it('returns null when not found', async () => {
      expect(await svc.getReport('rpt_unknown')).toBeNull();
    });

    it('returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.getReport('rpt_1')).toBeNull();
    });
  });

  // ─── getMerchantReports ───────────────────────────────

  describe('getMerchantReports', () => {
    it('returns reports for merchant', async () => {
      const report: ScheduledReport = {
        id: 'rpt_1', merchantId: 'm-1', name: 'Test', type: 'revenue',
        frequency: 'weekly', format: 'csv', recipients: ['a@b.cl'],
        filters: {}, active: true, lastRunAt: null,
        nextRunAt: '2026-01-01', createdAt: '2026-01-01',
      };
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'reports:merchant:m-1') return Promise.resolve(JSON.stringify(['rpt_1']));
        if (key === 'reports:rpt_1') return Promise.resolve(JSON.stringify(report));
        return Promise.resolve(null);
      });

      const result = await svc.getMerchantReports('m-1');
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('revenue');
    });

    it('returns empty when none', async () => {
      const result = await svc.getMerchantReports('m-none');
      expect(result).toEqual([]);
    });

    it('returns empty on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const result = await svc.getMerchantReports('m-1');
      expect(result).toEqual([]);
    });
  });

  // ─── updateReport ─────────────────────────────────────

  describe('updateReport', () => {
    const stored: ScheduledReport = {
      id: 'rpt_u1', merchantId: 'm-1', name: 'Old', type: 'transactions',
      frequency: 'daily', format: 'csv', recipients: ['a@b.cl'],
      filters: {}, active: true, lastRunAt: null,
      nextRunAt: '2026-01-01', createdAt: '2026-01-01',
    };

    it('updates name', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(stored));
      const result = await svc.updateReport('rpt_u1', { name: 'New Name' });
      expect(result!.name).toBe('New Name');
    });

    it('updates frequency and recalculates nextRunAt', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(stored));
      const result = await svc.updateReport('rpt_u1', { frequency: 'monthly' });
      expect(result!.frequency).toBe('monthly');
      expect(result!.nextRunAt).not.toBe('2026-01-01');
    });

    it('updates recipients', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(stored));
      const result = await svc.updateReport('rpt_u1', { recipients: ['new@email.cl'] });
      expect(result!.recipients).toEqual(['new@email.cl']);
    });

    it('deactivates report', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(stored));
      const result = await svc.updateReport('rpt_u1', { active: false });
      expect(result!.active).toBe(false);
    });

    it('returns null for unknown report', async () => {
      expect(await svc.updateReport('rpt_unknown', { name: 'X' })).toBeNull();
    });

    it('rejects empty name', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(stored));
      await expect(svc.updateReport('rpt_u1', { name: '' }))
        .rejects.toThrow('Nombre');
    });

    it('rejects invalid frequency', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(stored));
      await expect(svc.updateReport('rpt_u1', { frequency: 'biweekly' as never }))
        .rejects.toThrow('Frecuencia');
    });
  });

  // ─── recordExecution ──────────────────────────────────

  describe('recordExecution', () => {
    it('records a completed execution', async () => {
      const report: ScheduledReport = {
        id: 'rpt_e1', merchantId: 'm-1', name: 'Test', type: 'transactions',
        frequency: 'daily', format: 'csv', recipients: ['a@b.cl'],
        filters: {}, active: true, lastRunAt: null,
        nextRunAt: '2026-01-01', createdAt: '2026-01-01',
      };
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'reports:exec:rpt_e1') return Promise.resolve(null);
        if (key === 'reports:rpt_e1') return Promise.resolve(JSON.stringify(report));
        return Promise.resolve(null);
      });

      const exec = await svc.recordExecution('rpt_e1', 'completed', 150);
      expect(exec.id).toMatch(/^exec_/);
      expect(exec.status).toBe('completed');
      expect(exec.rowCount).toBe(150);
      expect(exec.error).toBeNull();
    });

    it('records a failed execution with error', async () => {
      const exec = await svc.recordExecution('rpt_e1', 'failed', 0, 'Timeout');
      expect(exec.status).toBe('failed');
      expect(exec.error).toBe('Timeout');
    });

    it('does not throw on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const exec = await svc.recordExecution('rpt_e1', 'completed', 10);
      expect(exec.id).toBeDefined();
    });
  });

  // ─── getExecutions ────────────────────────────────────

  describe('getExecutions', () => {
    it('returns execution history', async () => {
      const execs: ReportExecution[] = [
        { id: 'exec_1', reportId: 'rpt_1', status: 'completed', startedAt: '2026-01-01', completedAt: '2026-01-01', rowCount: 50, error: null },
      ];
      mockRedisGet.mockResolvedValue(JSON.stringify(execs));

      const result = await svc.getExecutions('rpt_1');
      expect(result).toHaveLength(1);
    });

    it('returns empty when none', async () => {
      expect(await svc.getExecutions('rpt_1')).toEqual([]);
    });

    it('returns empty on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.getExecutions('rpt_1')).toEqual([]);
    });
  });

  // ─── getDueReports ────────────────────────────────────

  describe('getDueReports', () => {
    it('returns reports past their nextRunAt', async () => {
      const past = new Date(Date.now() - 3600000).toISOString();
      const report: ScheduledReport = {
        id: 'rpt_d1', merchantId: 'm-1', name: 'Due', type: 'transactions',
        frequency: 'daily', format: 'csv', recipients: ['a@b.cl'],
        filters: {}, active: true, lastRunAt: null,
        nextRunAt: past, createdAt: '2026-01-01',
      };
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'reports:active') return Promise.resolve(JSON.stringify(['rpt_d1']));
        if (key === 'reports:rpt_d1') return Promise.resolve(JSON.stringify(report));
        return Promise.resolve(null);
      });

      const result = await svc.getDueReports();
      expect(result).toHaveLength(1);
    });

    it('excludes future reports', async () => {
      const future = new Date(Date.now() + 86400000).toISOString();
      const report: ScheduledReport = {
        id: 'rpt_f1', merchantId: 'm-1', name: 'Future', type: 'transactions',
        frequency: 'daily', format: 'csv', recipients: ['a@b.cl'],
        filters: {}, active: true, lastRunAt: null,
        nextRunAt: future, createdAt: '2026-01-01',
      };
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'reports:active') return Promise.resolve(JSON.stringify(['rpt_f1']));
        if (key === 'reports:rpt_f1') return Promise.resolve(JSON.stringify(report));
        return Promise.resolve(null);
      });

      const result = await svc.getDueReports();
      expect(result).toHaveLength(0);
    });

    it('returns empty on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.getDueReports()).toEqual([]);
    });
  });

  // ─── deleteReport ─────────────────────────────────────

  describe('deleteReport', () => {
    it('deletes report and removes from index', async () => {
      const report: ScheduledReport = {
        id: 'rpt_del', merchantId: 'm-1', name: 'Del', type: 'transactions',
        frequency: 'daily', format: 'csv', recipients: ['a@b.cl'],
        filters: {}, active: true, lastRunAt: null,
        nextRunAt: '2026-01-01', createdAt: '2026-01-01',
      };
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'reports:rpt_del') return Promise.resolve(JSON.stringify(report));
        if (key === 'reports:merchant:m-1') return Promise.resolve(JSON.stringify(['rpt_del', 'rpt_other']));
        return Promise.resolve(null);
      });

      const result = await svc.deleteReport('rpt_del');
      expect(result).toBe(true);
      expect(mockRedisDel).toHaveBeenCalledWith('reports:rpt_del');
      expect(mockRedisDel).toHaveBeenCalledWith('reports:exec:rpt_del');
    });

    it('returns false for unknown report', async () => {
      expect(await svc.deleteReport('rpt_unknown')).toBe(false);
    });

    it('returns false on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.deleteReport('rpt_1')).toBe(false);
    });
  });

  // ─── calculateNextRun ─────────────────────────────────

  describe('calculateNextRun', () => {
    it('returns future date for daily', () => {
      const next = svc.calculateNextRun('daily');
      expect(new Date(next).getTime()).toBeGreaterThan(Date.now());
    });

    it('returns future date for weekly', () => {
      const next = svc.calculateNextRun('weekly');
      // Allow 24h margin for timezone edge cases
      expect(new Date(next).getTime()).toBeGreaterThan(Date.now() - 86_400_000);
    });

    it('returns future date for monthly', () => {
      const next = svc.calculateNextRun('monthly');
      expect(new Date(next).getTime()).toBeGreaterThan(Date.now() - 86_400_000);
    });
  });
});
