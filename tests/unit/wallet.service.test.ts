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
