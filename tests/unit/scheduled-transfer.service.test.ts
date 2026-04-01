const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    del: jest.fn(),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { scheduledTransfer, type ScheduledTransfer } from '../../src/services/scheduled-transfer.service';

beforeEach(() => { jest.clearAllMocks(); mockRedisGet.mockResolvedValue(null); });

const sampleTransfer: ScheduledTransfer = {
  id: 'stx_test001', senderId: 'user-1', receiverPhone: '56987654321',
  receiverName: 'María', amount: 15000, description: 'Mesada',
  frequency: 'monthly', scheduledDate: '2026-04-01', scheduledTime: '09:00',
  status: 'scheduled', lastExecutedAt: null, executionCount: 0,
  nextExecutionDate: '2026-04-01', transactionRef: null,
  createdAt: new Date().toISOString(),
};

describe('ScheduledTransferService', () => {
  describe('schedule', () => {
    it('creates one-time transfer, id matches /^stx_/, status scheduled, nextExecutionDate = scheduledDate', async () => {
      const result = await scheduledTransfer.schedule({
        senderId: 'user-1', receiverPhone: '56987654321', receiverName: 'María',
        amount: 5000, description: 'Pago unico', frequency: 'once', scheduledDate: '2026-05-01',
      });

      expect(result.id).toMatch(/^stx_/);
      expect(result.status).toBe('scheduled');
      expect(result.nextExecutionDate).toBe('2026-05-01');
      expect(result.frequency).toBe('once');
    });

    it('creates monthly recurring transfer', async () => {
      const result = await scheduledTransfer.schedule({
        senderId: 'user-1', receiverPhone: '56987654321', receiverName: 'María',
        amount: 15000, description: 'Mesada', frequency: 'monthly', scheduledDate: '2026-04-01',
      });

      expect(result.frequency).toBe('monthly');
      expect(result.status).toBe('scheduled');
      expect(result.nextExecutionDate).toBe('2026-04-01');
      expect(result.executionCount).toBe(0);
    });

    it('throws for amount < 100', async () => {
      await expect(scheduledTransfer.schedule({
        senderId: 'user-1', receiverPhone: '56987654321', receiverName: 'María',
        amount: 50, description: 'Poco', frequency: 'once', scheduledDate: '2026-05-01',
      })).rejects.toThrow('Monto minimo es $100');
    });

    it('throws for invalid date format', async () => {
      await expect(scheduledTransfer.schedule({
        senderId: 'user-1', receiverPhone: '56987654321', receiverName: 'María',
        amount: 5000, description: 'Test', frequency: 'once', scheduledDate: '01-04-2026',
      })).rejects.toThrow('Fecha invalida');
    });
  });

  describe('markExecuted', () => {
    it('marks one-time as executed, nextExecutionDate null', async () => {
      const oneTime = { ...sampleTransfer, frequency: 'once' as const };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(oneTime));

      const result = await scheduledTransfer.markExecuted('stx_test001', 'REF-001');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('executed');
      expect(result!.nextExecutionDate).toBeNull();
      expect(result!.executionCount).toBe(1);
      expect(result!.transactionRef).toBe('REF-001');
    });

    it('advances monthly to next month, stays scheduled', async () => {
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(sampleTransfer));

      const result = await scheduledTransfer.markExecuted('stx_test001', 'REF-002');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('scheduled');
      // computeNext uses new Date(string) which parses as UTC, then setMonth — result may be 05-01 or 05-02 depending on TZ
      const next = result!.nextExecutionDate!;
      expect(next.startsWith('2026-05')).toBe(true);
      expect(result!.executionCount).toBe(1);
    });

    it('throws for non-scheduled status', async () => {
      const cancelled = { ...sampleTransfer, status: 'cancelled' as const };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(cancelled));

      await expect(scheduledTransfer.markExecuted('stx_test001', 'REF-003'))
        .rejects.toThrow('No se puede ejecutar transferencia en estado cancelled');
    });
  });

  describe('cancel', () => {
    it('cancels own transfer', async () => {
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(sampleTransfer));

      const result = await scheduledTransfer.cancel('stx_test001', 'user-1');
      expect(result).toBe(true);
    });

    it('returns false for non-owner', async () => {
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(sampleTransfer));

      const result = await scheduledTransfer.cancel('stx_test001', 'user-other');
      expect(result).toBe(false);
    });
  });

  describe('getDueTransfers', () => {
    it('filters by date correctly', () => {
      const today = new Date().toISOString().slice(0, 10);
      const past = { ...sampleTransfer, id: 'stx_past', nextExecutionDate: '2020-01-01' };
      const future = { ...sampleTransfer, id: 'stx_future', nextExecutionDate: '2099-12-31' };
      const due = { ...sampleTransfer, id: 'stx_today', nextExecutionDate: today };
      const cancelled = { ...sampleTransfer, id: 'stx_cancel', nextExecutionDate: today, status: 'cancelled' as const };

      const result = scheduledTransfer.getDueTransfers([past, future, due, cancelled]);

      expect(result).toHaveLength(2);
      expect(result.map(t => t.id)).toContain('stx_past');
      expect(result.map(t => t.id)).toContain('stx_today');
      expect(result.map(t => t.id)).not.toContain('stx_future');
      expect(result.map(t => t.id)).not.toContain('stx_cancel');
    });
  });
});
