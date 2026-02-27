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
  transaction: { findMany: jest.fn(), aggregate: jest.fn() },
  $transaction: jest.fn(),
};

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

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
  });

  // ─── Successful payment ────────────────────────────────

  describe('successful payment', () => {
    it('returns transactionId, reference, and formatted senderBalance', async () => {
      const result = await svc.processP2PPayment(baseReq);
      expect(result.success).toBe(true);
      expect(result.transactionId).toBe('tx-uuid');
      expect(result.reference).toMatch(/^#WP-\d{4}-[A-Z0-9]{8}$/);
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
