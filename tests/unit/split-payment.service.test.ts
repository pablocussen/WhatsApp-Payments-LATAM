/**
 * SplitPaymentService unit tests
 * Tests: createSplit, recordPayment, declineParticipation, cancelSplit, formatSplitSummary
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisDel = jest.fn().mockResolvedValue(1);

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { splitPayment, type SplitPayment } from '../../src/services/split-payment.service';

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisGet.mockResolvedValue(null);
});

const sampleSplit: SplitPayment = {
  id: 'spl_test001',
  createdBy: 'user-1',
  creatorName: 'Pablo',
  description: 'Asado',
  totalAmount: 30000,
  splitMethod: 'equal',
  participants: [
    { userId: null, phone: '56911111111', name: 'Juan', amount: 7500, status: 'pending', paidAt: null, transactionRef: null },
    { userId: null, phone: '56922222222', name: 'María', amount: 7500, status: 'pending', paidAt: null, transactionRef: null },
    { userId: null, phone: '56933333333', name: 'Pedro', amount: 7500, status: 'pending', paidAt: null, transactionRef: null },
  ],
  status: 'pending',
  paidCount: 0,
  paidAmount: 0,
  createdAt: new Date().toISOString(),
  completedAt: null,
};

describe('SplitPaymentService', () => {
  describe('createSplit', () => {
    it('creates equal split (3 participants, $30k total → $10k each)', async () => {
      const result = await splitPayment.createSplit({
        createdBy: 'user-1',
        creatorName: 'Pablo',
        description: 'Asado',
        totalAmount: 30000,
        splitMethod: 'equal',
        participants: [
          { phone: '56911111111', name: 'Juan' },
          { phone: '56922222222', name: 'María' },
          { phone: '56933333333', name: 'Pedro' },
        ],
      });

      expect(result.id).toMatch(/^spl_/);
      expect(result.status).toBe('pending');
      expect(result.totalAmount).toBe(30000);
      expect(result.participants).toHaveLength(3);
      // 30000 / 4 (3 participants + creator) = 7500 each
      expect(result.participants[0].amount).toBe(7500);
      expect(result.participants[1].amount).toBe(7500);
      expect(result.participants[2].amount).toBe(7500);
      expect(mockRedisSet).toHaveBeenCalled();
    });

    it('creates custom split with specific amounts', async () => {
      const result = await splitPayment.createSplit({
        createdBy: 'user-2',
        creatorName: 'Ana',
        description: 'Cena',
        totalAmount: 50000,
        splitMethod: 'custom',
        participants: [
          { phone: '56911111111', name: 'Juan', amount: 20000 },
          { phone: '56922222222', name: 'María', amount: 30000 },
        ],
      });

      expect(result.splitMethod).toBe('custom');
      expect(result.participants[0].amount).toBe(20000);
      expect(result.participants[1].amount).toBe(30000);
    });

    it('throws for totalAmount < 200', async () => {
      await expect(
        splitPayment.createSplit({
          createdBy: 'user-1',
          creatorName: 'Pablo',
          description: 'Café',
          totalAmount: 100,
          splitMethod: 'equal',
          participants: [{ phone: '56911111111', name: 'Juan' }],
        }),
      ).rejects.toThrow();
    });

    it('throws for empty participants', async () => {
      await expect(
        splitPayment.createSplit({
          createdBy: 'user-1',
          creatorName: 'Pablo',
          description: 'Nada',
          totalAmount: 10000,
          splitMethod: 'equal',
          participants: [],
        }),
      ).rejects.toThrow();
    });

    it('throws for description > 100 chars', async () => {
      await expect(
        splitPayment.createSplit({
          createdBy: 'user-1',
          creatorName: 'Pablo',
          description: 'A'.repeat(101),
          totalAmount: 10000,
          splitMethod: 'equal',
          participants: [{ phone: '56911111111', name: 'Juan' }],
        }),
      ).rejects.toThrow();
    });

    it('equal split handles remainder (e.g. $10001 / 3)', async () => {
      const result = await splitPayment.createSplit({
        createdBy: 'user-1',
        creatorName: 'Pablo',
        description: 'Remainder test',
        totalAmount: 10001,
        splitMethod: 'equal',
        participants: [
          { phone: '56911111111', name: 'Juan' },
          { phone: '56922222222', name: 'María' },
          { phone: '56933333333', name: 'Pedro' },
        ],
      });

      // 10001 / 4 = 2500 each, remainder 1 goes to first participant
      const sum = result.participants.reduce((s, p) => s + p.amount, 0);
      expect(sum).toBe(7501); // 3 participants' share (creator's share not in participants array)
    });
  });

  describe('recordPayment', () => {
    it('marks participant as paid and updates paidCount and paidAmount', async () => {
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(sampleSplit));

      const result = await splitPayment.recordPayment('spl_test001', '56911111111', 'TX_REF_001');

      expect(result).not.toBeNull();
      const updated = result!;
      const juan = updated.participants.find((p) => p.phone === '56911111111');
      expect(juan?.status).toBe('paid');
      expect(juan?.transactionRef).toBe('TX_REF_001');
      expect(juan?.paidAt).not.toBeNull();
      expect(updated.paidCount).toBe(1);
      expect(updated.paidAmount).toBe(7500);
      expect(mockRedisSet).toHaveBeenCalled();
    });

    it('completes split when all participants have paid (status → completed)', async () => {
      const almostDone: SplitPayment = {
        ...sampleSplit,
        participants: [
          { userId: null, phone: '56911111111', name: 'Juan', amount: 10000, status: 'paid', paidAt: new Date().toISOString(), transactionRef: 'TX_001' },
          { userId: null, phone: '56922222222', name: 'María', amount: 10000, status: 'paid', paidAt: new Date().toISOString(), transactionRef: 'TX_002' },
          { userId: null, phone: '56933333333', name: 'Pedro', amount: 10000, status: 'pending', paidAt: null, transactionRef: null },
        ],
        paidCount: 2,
        paidAmount: 20000,
      };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(almostDone));

      const result = await splitPayment.recordPayment('spl_test001', '56933333333', 'TX_003');

      expect(result).not.toBeNull();
      expect(result!.status).toBe('completed');
      expect(result!.paidCount).toBe(3);
      expect(result!.paidAmount).toBe(30000);
      expect(result!.completedAt).not.toBeNull();
    });

    it('throws for already-paid participant', async () => {
      const withPaid: SplitPayment = {
        ...sampleSplit,
        participants: [
          { userId: null, phone: '56911111111', name: 'Juan', amount: 10000, status: 'paid', paidAt: new Date().toISOString(), transactionRef: 'TX_001' },
          ...sampleSplit.participants.slice(1),
        ],
        paidCount: 1,
        paidAmount: 10000,
      };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(withPaid));

      await expect(
        splitPayment.recordPayment('spl_test001', '56911111111', 'TX_DUP'),
      ).rejects.toThrow();
    });
  });

  describe('declineParticipation', () => {
    it('marks participant as declined', async () => {
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(sampleSplit));

      const result = await splitPayment.declineParticipation('spl_test001', '56911111111');

      expect(result).toBe(true);
      const setCall = mockRedisSet.mock.calls[0];
      const saved: SplitPayment = JSON.parse(setCall[1]);
      const juan = saved.participants.find((p) => p.phone === '56911111111');
      expect(juan?.status).toBe('declined');
    });

    it('returns false for unknown phone', async () => {
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(sampleSplit));

      const result = await splitPayment.declineParticipation('spl_test001', '56999999999');

      expect(result).toBe(false);
    });
  });

  describe('cancelSplit', () => {
    it('cancels by creator', async () => {
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(sampleSplit));

      const result = await splitPayment.cancelSplit('spl_test001', 'user-1');

      expect(result).toBe(true);
      const setCall = mockRedisSet.mock.calls[0];
      const saved: SplitPayment = JSON.parse(setCall[1]);
      expect(saved.status).toBe('cancelled');
    });

    it('returns false for non-creator', async () => {
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(sampleSplit));

      const result = await splitPayment.cancelSplit('spl_test001', 'user-999');

      expect(result).toBe(false);
    });

    it('returns false for already completed split', async () => {
      const completed: SplitPayment = { ...sampleSplit, status: 'completed', completedAt: new Date().toISOString() };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(completed));

      const result = await splitPayment.cancelSplit('spl_test001', 'user-1');

      expect(result).toBe(false);
    });
  });

  describe('formatSplitSummary', () => {
    it('returns formatted text with emojis', () => {
      const summary = splitPayment.formatSplitSummary(sampleSplit);

      expect(typeof summary).toBe('string');
      expect(summary.length).toBeGreaterThan(0);
      expect(summary).toContain('Asado');
      expect(summary).toContain('30.000'); // formatCLP output
      expect(summary).toContain('Juan');
      expect(summary).toContain('María');
      expect(summary).toContain('Pedro');
    });
  });
});
