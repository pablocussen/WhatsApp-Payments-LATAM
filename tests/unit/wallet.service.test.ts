/**
 * Unit tests for WalletService.
 * Prisma is fully mocked — no DB connection required.
 */

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test' },
}));

const mockWallet = { balance: BigInt(50_000), currency: 'CLP', userId: 'uid-1' };

const mockTx = {
  transaction: { create: jest.fn() },
  wallet: { update: jest.fn().mockResolvedValue(mockWallet) },
  $queryRaw: jest.fn(),
};

const mockPrisma = {
  wallet: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn(),
};

jest.mock('../../src/config/database', () => ({
  prisma: mockPrisma,
}));

import { WalletService, InsufficientFundsError } from '../../src/services/wallet.service';

describe('WalletService', () => {
  let svc: WalletService;

  beforeEach(() => {
    svc = new WalletService();
    jest.clearAllMocks();

    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    );
    mockTx.wallet.update.mockResolvedValue(mockWallet);
  });

  // ─── getBalance ────────────────────────────────────────

  describe('getBalance', () => {
    it('returns formatted balance', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue(mockWallet);
      const result = await svc.getBalance('uid-1');
      expect(result.balance).toBe(50_000);
      expect(result.formatted).toMatch(/50/);
      expect(result.currency).toBe('CLP');
    });

    it('throws if wallet not found', async () => {
      mockPrisma.wallet.findUnique.mockResolvedValue(null);
      await expect(svc.getBalance('uid-missing')).rejects.toThrow('Wallet not found');
    });
  });

  // ─── credit ────────────────────────────────────────────

  describe('credit', () => {
    it('rejects non-positive amounts', async () => {
      await expect(svc.credit('uid-1', 0, 'test')).rejects.toThrow('positive');
      await expect(svc.credit('uid-1', -100, 'test')).rejects.toThrow('positive');
    });

    it('increments wallet balance', async () => {
      mockPrisma.wallet.update.mockResolvedValue({ ...mockWallet, balance: BigInt(60_000) });
      const result = await svc.credit('uid-1', 10_000, 'Recarga');
      expect(result.balance).toBe(60_000);
      expect(mockPrisma.wallet.update).toHaveBeenCalledWith({
        where: { userId: 'uid-1' },
        data: { balance: { increment: 10_000 } },
      });
    });
  });

  // ─── debit ─────────────────────────────────────────────

  describe('debit', () => {
    it('rejects non-positive amounts', async () => {
      await expect(svc.debit('uid-1', 0, 'test')).rejects.toThrow('positive');
      await expect(svc.debit('uid-1', -50, 'test')).rejects.toThrow('positive');
    });

    it('throws InsufficientFundsError when balance is too low', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ balance: '5000' }]);

      await expect(svc.debit('uid-1', 10_000, 'Pago')).rejects.toBeInstanceOf(
        InsufficientFundsError,
      );
    });

    it('throws InsufficientFundsError when wallet row not found ($queryRaw returns empty)', async () => {
      mockTx.$queryRaw.mockResolvedValue([]); // no row returned

      await expect(svc.debit('uid-missing', 10_000, 'Pago')).rejects.toBeInstanceOf(
        InsufficientFundsError,
      );
    });

    it('decrements balance on success and returns new balance', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ balance: '50000' }]);
      mockTx.wallet.update.mockResolvedValue({ ...mockWallet, balance: BigInt(40_000) });

      const result = await svc.debit('uid-1', 10_000, 'Pago P2P');

      expect(result.balance).toBe(40_000);
      expect(mockTx.wallet.update).toHaveBeenCalledWith({
        where: { userId: 'uid-1' },
        data: { balance: { decrement: 10_000 } },
      });
    });
  });

  // ─── transfer ──────────────────────────────────────────

  describe('transfer', () => {
    const SENDER = 'sender-uuid-001';
    const RECEIVER = 'receiver-uuid-002';

    it('rejects self-transfer', async () => {
      await expect(svc.transfer('same', 'same', 1_000, 'test')).rejects.toThrow('yourself');
    });

    it('rejects non-positive amounts', async () => {
      await expect(svc.transfer(SENDER, RECEIVER, 0, 'test')).rejects.toThrow('positive');
    });

    it('throws InsufficientFundsError when sender balance is too low', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ balance: '500' }]);

      await expect(svc.transfer(SENDER, RECEIVER, 10_000, 'Pago')).rejects.toBeInstanceOf(
        InsufficientFundsError,
      );
    });

    it('throws InsufficientFundsError when sender wallet row not found ($queryRaw empty)', async () => {
      mockTx.$queryRaw.mockResolvedValue([]);

      await expect(svc.transfer(SENDER, RECEIVER, 10_000, 'Pago')).rejects.toBeInstanceOf(
        InsufficientFundsError,
      );
    });

    it('transfers atomically: debits sender and credits receiver', async () => {
      mockTx.$queryRaw.mockResolvedValue([{ balance: '50000' }]);
      const senderWallet = { ...mockWallet, userId: SENDER, balance: BigInt(40_000) };
      const receiverWallet = { ...mockWallet, userId: RECEIVER, balance: BigInt(60_000) };
      mockTx.wallet.update
        .mockResolvedValueOnce(senderWallet)
        .mockResolvedValueOnce(receiverWallet);

      const result = await svc.transfer(SENDER, RECEIVER, 10_000, 'Pago P2P');

      expect(result.senderBalance.balance).toBe(40_000);
      expect(result.receiverBalance.balance).toBe(60_000);
      expect(mockTx.wallet.update).toHaveBeenCalledTimes(2);
    });
  });

  // ─── InsufficientFundsError ────────────────────────────

  describe('InsufficientFundsError', () => {
    it('carries currentBalance and requestedAmount', () => {
      const err = new InsufficientFundsError(10_000, 50_000);
      expect(err.name).toBe('InsufficientFundsError');
      expect(err.currentBalance).toBe(10_000);
      expect(err.requestedAmount).toBe(50_000);
      expect(err.message).toMatch(/insuficiente/i);
    });

    it('is instanceof Error', () => {
      expect(new InsufficientFundsError(0, 1)).toBeInstanceOf(Error);
    });
  });

  // ─── topup (idempotency) ───────────────────────────────

  describe('topup', () => {
    it('rejects non-positive amounts', async () => {
      await expect(svc.topup('uid-1', 0, 'WEBPAY_CREDIT', 'REF-001', 'test')).rejects.toThrow(
        'positive',
      );
    });

    it('creates Transaction record and credits wallet', async () => {
      await svc.topup('uid-1', 10_000, 'WEBPAY_CREDIT', '#WP-2026-ABCD1234', 'Recarga WebPay');

      expect(mockTx.transaction.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            senderId: 'uid-1',
            receiverId: 'uid-1',
            amount: 10_000,
            status: 'COMPLETED',
            paymentMethod: 'WEBPAY_CREDIT',
            reference: '#WP-2026-ABCD1234',
          }),
        }),
      );
      expect(mockTx.wallet.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { balance: { increment: 10_000 } },
        }),
      );
    });

    it('returns current balance on P2002 (duplicate reference = already processed)', async () => {
      const p2002 = Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      mockPrisma.$transaction.mockRejectedValue(p2002);

      // getBalance fallback needs a working wallet.findUnique
      mockPrisma.wallet.findUnique.mockResolvedValue(mockWallet);

      const result = await svc.topup('uid-1', 10_000, 'KHIPU', 'KHIPU:pay-001', 'Recarga Khipu');
      expect(result.balance).toBe(50_000); // Returns existing balance, no double-credit
    });

    it('rethrows errors that are not P2002', async () => {
      mockPrisma.$transaction.mockRejectedValue(new Error('DB timeout'));
      await expect(svc.topup('uid-1', 10_000, 'KHIPU', 'KHIPU:pay-001', 'test')).rejects.toThrow(
        'DB timeout',
      );
    });
  });
});
