/**
 * Unit tests for FraudService.
 * Redis and Prisma are fully mocked — no external connections required.
 */

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test' },
}));

// ─── Mock Redis ───────────────────────────────────────────

const mockRedis = {
  get: jest.fn(),
  multi: jest.fn().mockReturnValue({
    incr: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([1, true]),
  }),
};

// ─── Mock Prisma ──────────────────────────────────────────

const mockPrisma = {
  transaction: {
    aggregate: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
  },
};

jest.mock('../../src/config/database', () => ({
  prisma: mockPrisma,
  getRedis: () => mockRedis,
}));

import { FraudService } from '../../src/services/fraud.service';

const BASE_INPUT = {
  senderId: 'sender-uuid',
  receiverId: 'receiver-uuid',
  amount: 10_000,
  senderPhone: '+56912345678',
};

describe('FraudService.checkTransaction', () => {
  let svc: FraudService;

  beforeEach(() => {
    svc = new FraudService();
    jest.clearAllMocks();

    // Default: safe scenario (all rules return 0)
    mockRedis.get.mockResolvedValue('0'); // velocity: 0 recent txns
    mockPrisma.transaction.aggregate.mockResolvedValue({
      _avg: { amount: 10_000 },
      _max: { amount: 15_000 },
      _count: 10, // enough history to skip new-user flag
    });
    mockPrisma.transaction.findFirst.mockResolvedValue({ id: 'previous-tx' }); // known receiver
    mockPrisma.transaction.count.mockResolvedValue(5); // few daily txns

    // Freeze hour to 14:00 (safe hour) to avoid late-night flag
    jest.spyOn(Date.prototype, 'getHours').mockReturnValue(14);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── Approve path ────────────────────────────────────────

  describe('approve', () => {
    it('returns approve with score ~0 in normal conditions', async () => {
      const result = await svc.checkTransaction(BASE_INPUT);
      expect(result.action).toBe('approve');
      expect(result.score).toBeLessThan(0.3);
      expect(result.reasons).toHaveLength(0);
    });

    it('includes processingTimeMs', async () => {
      const result = await svc.checkTransaction(BASE_INPUT);
      expect(result.processingTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('records velocity after each transaction', async () => {
      await svc.checkTransaction(BASE_INPUT);
      expect(mockRedis.multi).toHaveBeenCalled();
    });
  });

  // ─── Velocity rule ───────────────────────────────────────

  describe('velocity check', () => {
    it('adds 0.2 score when txn count >= half the window limit', async () => {
      mockRedis.get.mockResolvedValue('5'); // half of MAX_TX_PER_WINDOW (10)
      const result = await svc.checkTransaction(BASE_INPUT);
      expect(result.score).toBeGreaterThanOrEqual(0.2);
      expect(result.reasons.some((r) => r.includes('frecuencia'))).toBe(true);
    });

    it('adds 0.5 score when txn count >= MAX_TX_PER_WINDOW (10)', async () => {
      mockRedis.get.mockResolvedValue('10'); // at limit
      const result = await svc.checkTransaction(BASE_INPUT);
      expect(result.score).toBeGreaterThanOrEqual(0.5);
    });

    it('fails open when Redis throws (returns 0 velocity)', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis down'));
      const result = await svc.checkTransaction(BASE_INPUT);
      // Should still work, just without velocity score
      expect(result).toBeDefined();
      expect(result.action).not.toBeUndefined();
    });
  });

  // ─── Amount anomaly rule ─────────────────────────────────

  describe('amount anomaly', () => {
    it('flags new user (< 3 txns) sending > $100,000', async () => {
      mockPrisma.transaction.aggregate.mockResolvedValue({
        _avg: { amount: null },
        _max: { amount: null },
        _count: 1, // new user
      });
      const result = await svc.checkTransaction({ ...BASE_INPUT, amount: 150_000 });
      expect(result.score).toBeGreaterThan(0);
      expect(result.reasons.some((r) => r.includes('inusual'))).toBe(true);
    });

    it('does not flag new user sending <= $100,000', async () => {
      mockPrisma.transaction.aggregate.mockResolvedValue({
        _avg: { amount: null },
        _max: { amount: null },
        _count: 2, // still new user
      });
      const result = await svc.checkTransaction({ ...BASE_INPUT, amount: 50_000 });
      // Amount anomaly score should be 0 (no flag)
      const amountFlag = result.reasons.some((r) => r.includes('inusual'));
      expect(amountFlag).toBe(false);
    });

    it('adds 0.3 when amount > 3x historical average', async () => {
      mockPrisma.transaction.aggregate.mockResolvedValue({
        _avg: { amount: 10_000 },
        _max: { amount: 15_000 },
        _count: 10,
      });
      // 3x avg = 30,000; send 31,000
      const result = await svc.checkTransaction({ ...BASE_INPUT, amount: 31_000 });
      expect(result.score).toBeGreaterThanOrEqual(0.3);
    });
  });

  // ─── New receiver rule ───────────────────────────────────

  describe('new receiver', () => {
    it('adds 0.1 for first payment to a receiver', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValue(null); // no prior tx
      const result = await svc.checkTransaction(BASE_INPUT);
      expect(result.score).toBeGreaterThanOrEqual(0.1);
      expect(result.reasons.some((r) => r.includes('destinatario'))).toBe(true);
    });

    it('does not flag known receiver', async () => {
      mockPrisma.transaction.findFirst.mockResolvedValue({ id: 'prev' });
      const result = await svc.checkTransaction(BASE_INPUT);
      const newReceiverFlag = result.reasons.some((r) => r.includes('destinatario'));
      expect(newReceiverFlag).toBe(false);
    });
  });

  // ─── Late-night rule ─────────────────────────────────────

  describe('late-night rule', () => {
    it('adds 0.15 for transactions between 01:00-05:00', async () => {
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(3); // 3 AM
      const result = await svc.checkTransaction(BASE_INPUT);
      expect(result.reasons.some((r) => r.includes('madrugada'))).toBe(true);
      expect(result.score).toBeGreaterThanOrEqual(0.15);
    });

    it('does not flag normal business hours', async () => {
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(10); // 10 AM
      const result = await svc.checkTransaction(BASE_INPUT);
      const lateNightFlag = result.reasons.some((r) => r.includes('madrugada'));
      expect(lateNightFlag).toBe(false);
    });
  });

  // ─── Daily limit rule ────────────────────────────────────

  describe('daily limit', () => {
    it('adds 0.4 when daily txn count >= limit (50)', async () => {
      mockPrisma.transaction.count.mockResolvedValue(50);
      const result = await svc.checkTransaction(BASE_INPUT);
      expect(result.score).toBeGreaterThanOrEqual(0.4);
      expect(result.reasons.some((r) => r.includes('hoy'))).toBe(true);
    });

    it('adds 0.1 when daily count >= half the limit (25)', async () => {
      mockPrisma.transaction.count.mockResolvedValue(25);
      const result = await svc.checkTransaction(BASE_INPUT);
      expect(result.score).toBeGreaterThanOrEqual(0.1);
    });
  });

  // ─── Score thresholds and clamping ──────────────────────

  describe('score thresholds', () => {
    it('blocks when score >= 0.7', async () => {
      // Pile on: velocity=0.5, daily=0.4 → score=0.9
      mockRedis.get.mockResolvedValue('10'); // velocity at limit → 0.5
      mockPrisma.transaction.count.mockResolvedValue(50); // daily at limit → 0.4
      const result = await svc.checkTransaction(BASE_INPUT);
      expect(result.action).toBe('block');
      expect(result.score).toBeGreaterThanOrEqual(0.7);
    });

    it('flags for review when score is between 0.3 and 0.7', async () => {
      // velocity=0.2 (half window) + new receiver=0.1 = 0.3
      mockRedis.get.mockResolvedValue('5'); // half window → 0.2
      mockPrisma.transaction.findFirst.mockResolvedValue(null); // new receiver → 0.1
      const result = await svc.checkTransaction(BASE_INPUT);
      expect(result.action).toBe('review');
    });

    it('clamps score to maximum of 1.0', async () => {
      // All rules fire simultaneously → score could exceed 1.0
      mockRedis.get.mockResolvedValue('10'); // 0.5
      mockPrisma.transaction.count.mockResolvedValue(50); // 0.4
      mockPrisma.transaction.findFirst.mockResolvedValue(null); // 0.1
      jest.spyOn(Date.prototype, 'getHours').mockReturnValue(3); // 0.15

      const result = await svc.checkTransaction(BASE_INPUT);
      expect(result.score).toBeLessThanOrEqual(1.0);
    });
  });

  // ─── Velocity counter error handling ────────────────────

  describe('incrementVelocityCounter Redis error', () => {
    it('silently swallows Redis errors (non-critical path)', async () => {
      // Redis multi().exec() throws → catch {} swallows it → result still returns
      mockRedis.multi.mockReturnValue({
        incr: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error('Redis connection lost')),
      });

      // Should resolve without throwing even if Redis fails
      const result = await svc.checkTransaction(BASE_INPUT);
      expect(result).toBeDefined();
      expect(result.action).toBe('approve');
    });
  });
});
