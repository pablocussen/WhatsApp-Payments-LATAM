/**
 * Unit tests for TransactionService.processP2PPayment.
 * Prisma and FraudService are fully mocked — no DB or Redis required.
 */

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test', ENCRYPTION_KEY_HEX: '0'.repeat(64) },
}));

// ─── Prisma mock ─────────────────────────────────────────

const mockTx = {
  transaction: {
    create: jest.fn(),
    update: jest.fn(),
    aggregate: jest.fn(),
  },
  wallet: {
    update: jest.fn(),
  },
  $queryRaw: jest.fn(),
};

const mockPrisma = {
  user: { findUnique: jest.fn() },
  transaction: { findMany: jest.fn(), aggregate: jest.fn(), findFirst: jest.fn() },
  auditEvent: { create: jest.fn().mockResolvedValue({}) },
  $transaction: jest.fn(),
};

const mockRedisGet = jest.fn();
const mockRedisMulti = jest.fn().mockReturnValue({
  incr: jest.fn().mockReturnThis(),
  expire: jest.fn().mockReturnThis(),
  exec: jest.fn().mockResolvedValue([]),
});

jest.mock('../../src/config/database', () => ({
  prisma: mockPrisma,
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    multi: () => mockRedisMulti(),
  }),
}));

// ─── FraudService mock ───────────────────────────────────

const mockCheckTransaction = jest.fn();
jest.mock('../../src/services/fraud.service', () => ({
  FraudService: jest.fn().mockImplementation(() => ({
    checkTransaction: mockCheckTransaction,
  })),
}));

// ─── WalletService mock (only used transitively — not called directly in processP2PPayment) ─
jest.mock('../../src/services/wallet.service', () => {
  class InsufficientFundsError extends Error {
    currentBalance: number;
    requestedAmount: number;
    constructor(current: number, requested: number) {
      super(`Saldo insuficiente. Tienes $${current} CLP y necesitas $${requested} CLP.`);
      this.name = 'InsufficientFundsError';
      this.currentBalance = current;
      this.requestedAmount = requested;
    }
  }
  return {
    WalletService: jest.fn().mockImplementation(() => ({})),
    InsufficientFundsError,
  };
});

import { TransactionService } from '../../src/services/transaction.service';
import { InsufficientFundsError } from '../../src/services/wallet.service';

// ─── Helpers ─────────────────────────────────────────────

const SENDER_ID = 'sender-uuid-0001';
const RECEIVER_ID = 'receiver-uuid-0002';
const SENDER_WA_ID = '+56912345678';

const baseReq = {
  senderId: SENDER_ID,
  senderWaId: SENDER_WA_ID,
  receiverId: RECEIVER_ID,
  amount: 10_000,
  paymentMethod: 'WALLET' as const,
};

const approvedFraud = { action: 'approve' as const, score: 0.1, reasons: [] };

// ─── Test Suite ──────────────────────────────────────────

describe('TransactionService.processP2PPayment', () => {
  let svc: TransactionService;

  beforeEach(() => {
    svc = new TransactionService();
    jest.clearAllMocks();

    // Default: transaction callback forwards to mockTx
    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    );

    // Default: no rate limit
    mockRedisGet.mockResolvedValue(null);

    // Default user: BASIC KYC (perTx=50000, monthly=200000)
    mockPrisma.user.findUnique.mockResolvedValue({ id: SENDER_ID, kycLevel: 'BASIC' });

    // Default: fraud approved
    mockCheckTransaction.mockResolvedValue(approvedFraud);

    // Default inside-tx mocks
    mockTx.transaction.create.mockResolvedValue({ id: 'tx-uuid' });
    mockTx.$queryRaw.mockResolvedValue([{ balance: '50000' }]); // 50k balance
    mockTx.transaction.aggregate.mockResolvedValue({ _sum: { amount: null } }); // 0 monthly
    mockTx.wallet.update.mockResolvedValue({});
    mockTx.transaction.update.mockResolvedValue({});
  });

  // ─── Guard checks (no DB needed) ───────────────────────

  describe('input validation', () => {
    it('rejects self-payment', async () => {
      const result = await svc.processP2PPayment({
        ...baseReq,
        senderId: SENDER_ID,
        receiverId: SENDER_ID,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/ti mismo/i);
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('rejects amount below minimum', async () => {
      const result = await svc.processP2PPayment({ ...baseReq, amount: 99 });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/mínimo/i);
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('accepts minimum valid amount (100)', async () => {
      const result = await svc.processP2PPayment({ ...baseReq, amount: 100 });
      expect(result.success).toBe(true);
    });
  });

  // ─── KYC checks ────────────────────────────────────────

  describe('KYC limits', () => {
    it('returns error when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      const result = await svc.processP2PPayment(baseReq);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no encontrado/i);
    });

    it('rejects amount above BASIC per-tx limit (50000)', async () => {
      const result = await svc.processP2PPayment({ ...baseReq, amount: 50_001 });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/máximo/i);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('accepts amount exactly at BASIC per-tx limit', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ balance: '50000' }]);
      const result = await svc.processP2PPayment({ ...baseReq, amount: 50_000 });
      expect(result.success).toBe(true);
    });

    it('INTERMEDIATE users have higher limit (500000)', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: SENDER_ID, kycLevel: 'INTERMEDIATE' });
      mockTx.$queryRaw.mockResolvedValue([{ balance: '600000' }]);
      const result = await svc.processP2PPayment({ ...baseReq, amount: 500_000 });
      expect(result.success).toBe(true);
    });

    it('falls back to BASIC limits for unknown kycLevel', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ id: SENDER_ID, kycLevel: 'UNKNOWN_LEVEL' });
      // Amount within BASIC perTx (50000) → should succeed with fallback limits
      const result = await svc.processP2PPayment({ ...baseReq, amount: 10_000 });
      expect(result.success).toBe(true);
    });
  });

  // ─── Fraud checks ──────────────────────────────────────

  describe('fraud detection', () => {
    it('blocks payment when fraud action is block', async () => {
      mockCheckTransaction.mockResolvedValue({
        action: 'block',
        score: 0.9,
        reasons: ['velocity'],
      });
      const result = await svc.processP2PPayment(baseReq);
      expect(result.success).toBe(false);
      expect(result.fraudBlocked).toBe(true);
      expect(result.error).toMatch(/bloqueada/i);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('allows payment when fraud action is review (score < block threshold)', async () => {
      mockCheckTransaction.mockResolvedValue({ action: 'review', score: 0.5, reasons: [] });
      const result = await svc.processP2PPayment(baseReq);
      expect(result.success).toBe(true);
      expect(result.fraudBlocked).toBeUndefined();
    });
  });

  // ─── Fee calculation ───────────────────────────────────

  describe('fee calculation', () => {
    it('P2P wallet payments have zero fee', async () => {
      const result = await svc.processP2PPayment({ ...baseReq, paymentMethod: 'WALLET' });
      expect(result.success).toBe(true);
      expect(result.fee).toBe(0);
    });

    it('WebPay Credit has 2.8% + $50 fee', async () => {
      const result = await svc.processP2PPayment({
        ...baseReq,
        paymentMethod: 'WEBPAY_CREDIT',
      });
      expect(result.success).toBe(true);
      // 10000 * 0.028 + 50 = 280 + 50 = 330
      expect(result.fee).toBe(330);
    });

    it('WebPay Debit has 1.8% + $50 fee', async () => {
      const result = await svc.processP2PPayment({
        ...baseReq,
        paymentMethod: 'WEBPAY_DEBIT',
      });
      expect(result.success).toBe(true);
      // 10000 * 0.018 + 50 = 180 + 50 = 230
      expect(result.fee).toBe(230);
    });

    it('Khipu has 1.0% fee', async () => {
      const result = await svc.processP2PPayment({ ...baseReq, paymentMethod: 'KHIPU' });
      expect(result.success).toBe(true);
      // 10000 * 0.01 = 100
      expect(result.fee).toBe(100);
    });

    it('falls back to WALLET fee config for unknown payment method', async () => {
      // Covers line 262: `const config = FEES[method] || FEES.WALLET`
      // An unknown method string → FEES[method] is undefined → falls back to FEES.WALLET
      // WALLET: 1.5% + $0 → 10000 * 0.015 = 150
      const result = await svc.processP2PPayment({
        ...baseReq,
        paymentMethod: 'LEGACY_TRANSFER' as 'KHIPU', // unknown method, cast to satisfy TS
      });
      expect(result.success).toBe(true);
      expect(result.fee).toBe(150);
    });
  });

  // ─── Successful payment ────────────────────────────────

  describe('successful payment', () => {
    it('returns transactionId, reference, and formatted senderBalance', async () => {
      const result = await svc.processP2PPayment(baseReq);
      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('tx-uuid');
      expect(result.reference).toMatch(/^#WP-\d{4}-[A-Z0-9]{16}$/);
      expect(result.senderBalance).toMatch(/\$/); // formatted CLP
    });

    it('creates transaction record inside DB transaction', async () => {
      await svc.processP2PPayment(baseReq);
      expect(mockTx.transaction.create).toHaveBeenCalledTimes(1);
      const data = mockTx.transaction.create.mock.calls[0][0].data;
      expect(data.senderId).toBe(SENDER_ID);
      expect(data.receiverId).toBe(RECEIVER_ID);
      expect(data.amount).toBe(10_000);
      expect(data.status).toBe('PROCESSING');
    });

    it('updates both wallets (debit sender, credit receiver)', async () => {
      await svc.processP2PPayment(baseReq);
      expect(mockTx.wallet.update).toHaveBeenCalledTimes(2);
      const [senderUpdate, receiverUpdate] = mockTx.wallet.update.mock.calls;
      expect(senderUpdate[0].data.balance.decrement).toBe(10_000);
      expect(receiverUpdate[0].data.balance.increment).toBe(10_000);
    });

    it('marks transaction COMPLETED in same DB transaction', async () => {
      await svc.processP2PPayment(baseReq);
      const updateCall = mockTx.transaction.update.mock.calls[0][0];
      expect(updateCall.data.status).toBe('COMPLETED');
      expect(updateCall.data.completedAt).toBeInstanceOf(Date);
    });
  });

  // ─── Insufficient funds ────────────────────────────────

  describe('insufficient funds', () => {
    it('returns error when balance too low', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ balance: '5000' }]); // only 5k
      const result = await svc.processP2PPayment({ ...baseReq, amount: 10_000 });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/insuficiente/i);
    });

    it('handles missing wallet row (balance 0)', async () => {
      mockTx.$queryRaw.mockResolvedValue([]); // no wallet row
      const result = await svc.processP2PPayment(baseReq);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/insuficiente/i);
    });
  });

  // ─── Monthly limit ─────────────────────────────────────

  describe('monthly limit', () => {
    it('rejects when monthly total + amount exceeds BASIC limit (200000)', async () => {
      // Already sent 195000 this month; amount = 10000 → total = 205000 > 200000
      mockTx.transaction.aggregate.mockResolvedValue({ _sum: { amount: BigInt(195_000) } });
      const result = await svc.processP2PPayment(baseReq);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/límite mensual/i);
    });

    it('allows payment when monthly total stays exactly at limit', async () => {
      // Already sent 190000; amount = 10000 → total = 200000 = limit (not exceeded)
      mockTx.transaction.aggregate.mockResolvedValue({ _sum: { amount: BigInt(190_000) } });
      const result = await svc.processP2PPayment(baseReq);
      expect(result.success).toBe(true);
    });
  });

  // ─── Unexpected errors ─────────────────────────────────

  describe('error handling', () => {
    it('returns generic error on unexpected DB failure (does not throw)', async () => {
      mockPrisma.$transaction.mockRejectedValue(new Error('DB connection dropped'));
      const result = await svc.processP2PPayment(baseReq);
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/error al procesar/i);
    });
  });
});

// ─── getTransactionHistory ────────────────────────────────

describe('TransactionService.getTransactionHistory', () => {
  let svc: TransactionService;

  beforeEach(() => {
    svc = new TransactionService();
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    );
  });

  it('returns "no transactions" message when history is empty', async () => {
    mockPrisma.transaction.findMany.mockResolvedValue([]);

    const result = await svc.getTransactionHistory(SENDER_ID);

    expect(result).toBe('No tienes transacciones aún.');
  });

  it('shows "↑ Enviado" when userId is the sender', async () => {
    mockPrisma.transaction.findMany.mockResolvedValue([
      {
        senderId: SENDER_ID,
        receiverId: RECEIVER_ID,
        amount: BigInt(5_000),
        reference: '#WP-2026-ABC',
        createdAt: new Date('2026-02-15T10:00:00Z'),
        sender: { name: 'Juan', waId: SENDER_WA_ID },
        receiver: { name: 'María', waId: '+56987654321' },
      },
    ]);

    const result = await svc.getTransactionHistory(SENDER_ID);

    expect(result).toContain('↑ Enviado');
    expect(result).toContain('María');
    expect(result).toContain('#WP-2026-ABC');
  });

  it('shows "↓ Recibido" when userId is the receiver', async () => {
    mockPrisma.transaction.findMany.mockResolvedValue([
      {
        senderId: SENDER_ID,
        receiverId: RECEIVER_ID,
        amount: BigInt(8_000),
        reference: '#WP-2026-XYZ',
        createdAt: new Date('2026-02-20T12:00:00Z'),
        sender: { name: 'Juan', waId: SENDER_WA_ID },
        receiver: { name: 'María', waId: '+56987654321' },
      },
    ]);

    const result = await svc.getTransactionHistory(RECEIVER_ID);

    expect(result).toContain('↓ Recibido');
    expect(result).toContain('Juan');
  });

  it('respects custom limit parameter', async () => {
    mockPrisma.transaction.findMany.mockResolvedValue([]);

    await svc.getTransactionHistory(SENDER_ID, 10);

    expect(mockPrisma.transaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10 }),
    );
  });

  it('falls back to waId when sender/receiver name is null', async () => {
    mockPrisma.transaction.findMany.mockResolvedValue([
      {
        senderId: SENDER_ID,
        receiverId: RECEIVER_ID,
        amount: BigInt(3_000),
        reference: '#WP-2026-NUL',
        createdAt: new Date('2026-02-28T09:00:00Z'),
        sender: { name: null, waId: SENDER_WA_ID },
        receiver: { name: null, waId: '+56999999999' },
      },
    ]);

    const result = await svc.getTransactionHistory(SENDER_ID);

    // Should show receiver waId as fallback for name
    expect(result).toContain('+56999999999');
  });

  it('falls back to sender waId when sender name is null (receiver view)', async () => {
    mockPrisma.transaction.findMany.mockResolvedValue([
      {
        senderId: SENDER_ID,
        receiverId: RECEIVER_ID,
        amount: BigInt(7_000),
        reference: '#WP-2026-RCV',
        createdAt: new Date('2026-02-28T11:00:00Z'),
        sender: { name: null, waId: SENDER_WA_ID },
        receiver: { name: 'María', waId: '+56987654321' },
      },
    ]);

    const result = await svc.getTransactionHistory(RECEIVER_ID);

    // Should use sender.waId as fallback (sender.name is null, isSender=false → line 224)
    expect(result).toContain(SENDER_WA_ID);
  });
});

// ─── getTransactionStats ─────────────────────────────────

describe('TransactionService.getTransactionStats', () => {
  let svc: TransactionService;

  beforeEach(() => {
    svc = new TransactionService();
    jest.clearAllMocks();
  });

  it('returns aggregated sent, received and monthly totals', async () => {
    mockPrisma.transaction.aggregate
      .mockResolvedValueOnce({ _sum: { amount: BigInt(50_000) }, _count: 3 })
      .mockResolvedValueOnce({ _sum: { amount: BigInt(20_000) } })
      .mockResolvedValueOnce({ _sum: { amount: BigInt(30_000) } });

    const result = await svc.getTransactionStats(SENDER_ID);

    expect(result.totalSent).toBe(50_000);
    expect(result.totalReceived).toBe(20_000);
    expect(result.txCount).toBe(3);
    expect(result.monthlySent).toBe(30_000);
  });

  it('returns zeros when no transactions exist (null sums)', async () => {
    mockPrisma.transaction.aggregate
      .mockResolvedValueOnce({ _sum: { amount: null }, _count: 0 })
      .mockResolvedValueOnce({ _sum: { amount: null } })
      .mockResolvedValueOnce({ _sum: { amount: null } });

    const result = await svc.getTransactionStats(SENDER_ID);

    expect(result.totalSent).toBe(0);
    expect(result.totalReceived).toBe(0);
    expect(result.txCount).toBe(0);
    expect(result.monthlySent).toBe(0);
  });
});

// ─── Per-user rate limit ────────────────────────────────

describe('TransactionService — per-user rate limit', () => {
  let svc: TransactionService;

  beforeEach(() => {
    svc = new TransactionService();
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    );
    mockPrisma.user.findUnique.mockResolvedValue({ id: SENDER_ID, kycLevel: 'BASIC' });
    mockCheckTransaction.mockResolvedValue(approvedFraud);
    mockTx.transaction.create.mockResolvedValue({ id: 'tx-uuid' });
    mockTx.$queryRaw.mockResolvedValue([{ balance: '100000' }]);
    mockTx.transaction.aggregate.mockResolvedValue({ _sum: { amount: BigInt(0) } });
    mockTx.wallet.update.mockResolvedValue({});
    mockTx.transaction.update.mockResolvedValue({});
  });

  it('blocks payment when user exceeds 10 payments per hour', async () => {
    mockRedisGet.mockResolvedValue('10'); // At the limit

    const result = await svc.processP2PPayment(baseReq);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Demasiados pagos');
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('allows payment when rate limit counter is below threshold', async () => {
    mockRedisGet.mockResolvedValue('5'); // Under limit

    const result = await svc.processP2PPayment(baseReq);

    expect(result.success).toBe(true);
  });

  it('fails open when Redis throws during rate limit check', async () => {
    mockRedisGet.mockRejectedValue(new Error('Redis down'));

    const result = await svc.processP2PPayment(baseReq);

    // Should not block — fail open
    expect(result.success).toBe(true);
  });

  it('completes payment even when Redis recordUserPayment throws', async () => {
    mockRedisGet.mockResolvedValue('0');
    // Make multi() throw after successful payment
    mockRedisMulti.mockReturnValue({
      incr: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockRejectedValue(new Error('Redis write fail')),
    });

    const result = await svc.processP2PPayment(baseReq);

    // Payment should still succeed even though rate limit recording failed
    expect(result.success).toBe(true);
    expect(result.reference).toBeDefined();
  });
});

// ─── Recent recipients ──────────────────────────────────

describe('TransactionService.getRecentRecipients', () => {
  let svc: TransactionService;

  beforeEach(() => {
    svc = new TransactionService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null); // cache miss
  });

  it('returns deduplicated recent recipients', async () => {
    mockPrisma.transaction.findMany.mockResolvedValue([
      { receiverId: 'r1', receiver: { id: 'r1', name: 'Ana', waId: '56911111111' } },
      { receiverId: 'r1', receiver: { id: 'r1', name: 'Ana', waId: '56911111111' } }, // dup
      { receiverId: 'r2', receiver: { id: 'r2', name: 'Pedro', waId: '56922222222' } },
      { receiverId: 'r3', receiver: { id: 'r3', name: null, waId: '56933333333' } },
    ]);

    const result = await svc.getRecentRecipients(SENDER_ID);

    expect(result).toHaveLength(3);
    expect(result[0].name).toBe('Ana');
    expect(result[1].name).toBe('Pedro');
    expect(result[2].waId).toBe('56933333333');
  });

  it('returns empty array when no transactions', async () => {
    mockPrisma.transaction.findMany.mockResolvedValue([]);

    const result = await svc.getRecentRecipients(SENDER_ID);

    expect(result).toHaveLength(0);
  });

  it('respects limit parameter', async () => {
    mockPrisma.transaction.findMany.mockResolvedValue([
      { receiverId: 'r1', receiver: { id: 'r1', name: 'A', waId: '561' } },
      { receiverId: 'r2', receiver: { id: 'r2', name: 'B', waId: '562' } },
      { receiverId: 'r3', receiver: { id: 'r3', name: 'C', waId: '563' } },
      { receiverId: 'r4', receiver: { id: 'r4', name: 'D', waId: '564' } },
    ]);

    const result = await svc.getRecentRecipients(SENDER_ID, 2);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('A');
    expect(result[1].name).toBe('B');
  });
});

// ─── getTransactionByReference ───────────────────────────

describe('TransactionService.getTransactionByReference', () => {
  let svc: TransactionService;

  beforeEach(() => {
    svc = new TransactionService();
    jest.clearAllMocks();
  });

  it('returns formatted receipt for sender', async () => {
    mockPrisma.transaction.findFirst.mockResolvedValue({
      senderId: SENDER_ID,
      receiverId: RECEIVER_ID,
      amount: 5000,
      fee: 0,
      status: 'COMPLETED',
      reference: '#WP-2026-AABB1122',
      createdAt: new Date('2026-03-01T12:00:00Z'),
      sender: { name: 'Juan', waId: '56912345678' },
      receiver: { name: 'Maria', waId: '56987654321' },
    });

    const result = await svc.getTransactionByReference('#WP-2026-AABB1122', SENDER_ID);

    expect(result).not.toBeNull();
    expect(result!.direction).toBe('Enviado');
    expect(result!.otherParty).toBe('Maria');
    expect(result!.reference).toBe('#WP-2026-AABB1122');
    expect(result!.status).toBe('COMPLETED');
  });

  it('returns formatted receipt for receiver', async () => {
    mockPrisma.transaction.findFirst.mockResolvedValue({
      senderId: 'other-user',
      receiverId: SENDER_ID,
      amount: 3000,
      fee: 0,
      status: 'COMPLETED',
      reference: '#WP-2026-CCDD3344',
      createdAt: new Date('2026-03-02T10:00:00Z'),
      sender: { name: 'Pedro', waId: '56955555555' },
      receiver: { name: 'Juan', waId: '56912345678' },
    });

    const result = await svc.getTransactionByReference('#WP-2026-CCDD3344', SENDER_ID);

    expect(result).not.toBeNull();
    expect(result!.direction).toBe('Recibido');
    expect(result!.otherParty).toBe('Pedro');
  });

  it('returns null when transaction not found', async () => {
    mockPrisma.transaction.findFirst.mockResolvedValue(null);

    const result = await svc.getTransactionByReference('#WP-NONEXISTENT', SENDER_ID);

    expect(result).toBeNull();
  });

  it('uses waId fallback when sender has no name', async () => {
    mockPrisma.transaction.findFirst.mockResolvedValue({
      senderId: 'other-user',
      receiverId: SENDER_ID,
      amount: 1000,
      fee: 0,
      status: 'COMPLETED',
      reference: '#WP-2026-EEFF5566',
      createdAt: new Date('2026-03-03T08:00:00Z'),
      sender: { name: null, waId: '56966666666' },
      receiver: { name: 'Juan', waId: '56912345678' },
    });

    const result = await svc.getTransactionByReference('#WP-2026-EEFF5566', SENDER_ID);

    expect(result!.otherParty).toBe('56966666666');
  });

  it('uses waId fallback when receiver has no name (sender view)', async () => {
    mockPrisma.transaction.findFirst.mockResolvedValue({
      senderId: SENDER_ID,
      receiverId: RECEIVER_ID,
      amount: 2000,
      fee: 0,
      status: 'COMPLETED',
      reference: '#WP-2026-GGHH7788',
      createdAt: new Date('2026-03-04T09:00:00Z'),
      sender: { name: 'Juan', waId: '56912345678' },
      receiver: { name: null, waId: '56977777777' },
    });

    const result = await svc.getTransactionByReference('#WP-2026-GGHH7788', SENDER_ID);

    expect(result!.direction).toBe('Enviado');
    expect(result!.otherParty).toBe('56977777777');
  });
});

// ─── refundTransaction ──────────────────────────────────

describe('TransactionService.refundTransaction', () => {
  let svc: TransactionService;

  const ORIGINAL_REF = '#WP-2026-ORIG0001';
  const completedAt = new Date(Date.now() - 1000 * 60 * 60); // 1 hour ago

  beforeEach(() => {
    svc = new TransactionService();
    jest.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    );
  });

  it('successfully refunds a received payment', async () => {
    mockPrisma.transaction.findFirst.mockResolvedValue({
      id: 'tx-orig',
      senderId: SENDER_ID,
      receiverId: RECEIVER_ID,
      amount: BigInt(5000),
      status: 'COMPLETED',
      completedAt,
    });
    mockTx.$queryRaw.mockResolvedValue([{ balance: '10000' }]);
    mockTx.wallet.update.mockResolvedValue({});
    mockTx.transaction.update.mockResolvedValue({});
    mockTx.transaction.create.mockResolvedValue({ id: 'tx-refund' });

    const result = await svc.refundTransaction(ORIGINAL_REF, RECEIVER_ID);

    expect(result.success).toBe(true);
    expect(result.refundReference).toMatch(/^#WP-\d{4}-[A-Z0-9]{16}$/);
    // Verify wallet debit (receiver) and credit (sender)
    expect(mockTx.wallet.update).toHaveBeenCalledTimes(2);
    // Verify original marked as REVERSED
    expect(mockTx.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'tx-orig' }, data: { status: 'REVERSED' } }),
    );
  });

  it('rejects refund when transaction not found', async () => {
    mockPrisma.transaction.findFirst.mockResolvedValue(null);

    const result = await svc.refundTransaction('#WP-NONEXISTENT', RECEIVER_ID);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/no encontrada/i);
  });

  it('rejects refund when requester is the sender (not receiver)', async () => {
    mockPrisma.transaction.findFirst.mockResolvedValue({
      id: 'tx-orig',
      senderId: SENDER_ID,
      receiverId: RECEIVER_ID,
      amount: BigInt(5000),
      status: 'COMPLETED',
      completedAt,
    });

    const result = await svc.refundTransaction(ORIGINAL_REF, SENDER_ID);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/solo quien recibió/i);
  });

  it('rejects refund after 72 hours', async () => {
    const oldDate = new Date(Date.now() - 1000 * 60 * 60 * 73); // 73 hours ago
    mockPrisma.transaction.findFirst.mockResolvedValue({
      id: 'tx-orig',
      senderId: SENDER_ID,
      receiverId: RECEIVER_ID,
      amount: BigInt(5000),
      status: 'COMPLETED',
      completedAt: oldDate,
    });

    const result = await svc.refundTransaction(ORIGINAL_REF, RECEIVER_ID);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/72 horas/i);
  });

  it('rejects refund when receiver wallet row is null', async () => {
    mockPrisma.transaction.findFirst.mockResolvedValue({
      id: 'tx-orig',
      senderId: SENDER_ID,
      receiverId: RECEIVER_ID,
      amount: BigInt(5000),
      status: 'COMPLETED',
      completedAt,
    });
    mockTx.$queryRaw.mockResolvedValue([]); // Empty result

    const result = await svc.refundTransaction(ORIGINAL_REF, RECEIVER_ID);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/saldo insuficiente/i);
  });

  it('rejects refund when receiver has insufficient funds', async () => {
    mockPrisma.transaction.findFirst.mockResolvedValue({
      id: 'tx-orig',
      senderId: SENDER_ID,
      receiverId: RECEIVER_ID,
      amount: BigInt(5000),
      status: 'COMPLETED',
      completedAt,
    });
    mockTx.$queryRaw.mockResolvedValue([{ balance: '1000' }]); // Not enough

    const result = await svc.refundTransaction(ORIGINAL_REF, RECEIVER_ID);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/saldo insuficiente/i);
  });

  it('returns generic error on unexpected DB failure', async () => {
    mockPrisma.transaction.findFirst.mockResolvedValue({
      id: 'tx-orig',
      senderId: SENDER_ID,
      receiverId: RECEIVER_ID,
      amount: BigInt(5000),
      status: 'COMPLETED',
      completedAt,
    });
    mockPrisma.$transaction.mockRejectedValue(new Error('DB crash'));

    const result = await svc.refundTransaction(ORIGINAL_REF, RECEIVER_ID);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/error al procesar/i);
  });
});
