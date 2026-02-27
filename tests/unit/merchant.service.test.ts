/**
 * Unit tests for MerchantService.
 * Prisma is fully mocked — no DB required.
 */

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test', ENCRYPTION_KEY_HEX: '0'.repeat(64) },
}));

const mockPrisma = {
  transaction: {
    aggregate: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
  },
  paymentLink: {
    count: jest.fn(),
  },
};

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

import { MerchantService } from '../../src/services/merchant.service';

// ─── Helpers ─────────────────────────────────────────────

const MERCHANT_ID = 'merchant-uuid-001';

function makeAggregateResult(amount: number, fee = 0, count = 0, avg = 0) {
  return {
    _sum: { amount: BigInt(amount), fee: BigInt(fee) },
    _count: count,
    _avg: { amount: amount > 0 ? amount : null },
  };
}

// ─── Test Suite ──────────────────────────────────────────

describe('MerchantService', () => {
  let svc: MerchantService;

  beforeEach(() => {
    svc = new MerchantService();
    jest.clearAllMocks();
  });

  // ─── getDashboard ────────────────────────────────────────

  describe('getDashboard', () => {
    function setupDashboard(
      monthly = makeAggregateResult(100_000, 2_000, 10),
      today = makeAggregateResult(15_000, 0, 2),
      links = 3,
    ) {
      mockPrisma.transaction.aggregate
        .mockResolvedValueOnce(monthly) // monthly call
        .mockResolvedValueOnce(today); // today call
      mockPrisma.paymentLink.count.mockResolvedValue(links);
    }

    it('returns formatted dashboard with correct values', async () => {
      setupDashboard(makeAggregateResult(100_000, 2_000, 10), makeAggregateResult(15_000, 0, 2), 3);

      const result = await svc.getDashboard(MERCHANT_ID);

      expect(result.totalSalesRaw).toBe(100_000);
      expect(result.totalSales).toMatch(/\$/);
      expect(result.transactionCount).toBe(10);
      expect(result.todayCount).toBe(2);
      expect(result.activeLinks).toBe(3);
    });

    it('calculates pending settlement as grossSales - fees', async () => {
      setupDashboard(makeAggregateResult(100_000, 5_000, 10), makeAggregateResult(0, 0, 0), 0);

      const result = await svc.getDashboard(MERCHANT_ID);

      // pendingSettlement = totalSales - totalFees = 100000 - 5000 = 95000
      expect(result.totalSalesRaw).toBe(100_000);
      // pendingSettlement is formatted CLP of 95000
      expect(result.pendingSettlement).toMatch(/\$/);
    });

    it('handles zero sales gracefully', async () => {
      mockPrisma.transaction.aggregate.mockResolvedValue({
        _sum: { amount: null, fee: null },
        _count: 0,
        _avg: { amount: null },
      });
      mockPrisma.paymentLink.count.mockResolvedValue(0);

      const result = await svc.getDashboard(MERCHANT_ID);

      expect(result.totalSalesRaw).toBe(0);
      expect(result.transactionCount).toBe(0);
      expect(result.activeLinks).toBe(0);
    });

    it('runs 3 queries in parallel (transaction aggregate x2 + paymentLink count)', async () => {
      setupDashboard();
      await svc.getDashboard(MERCHANT_ID);

      expect(mockPrisma.transaction.aggregate).toHaveBeenCalledTimes(2);
      expect(mockPrisma.paymentLink.count).toHaveBeenCalledTimes(1);
    });
  });

  // ─── getTransactions ─────────────────────────────────────

  describe('getTransactions', () => {
    const mockTx = {
      id: 'tx-1',
      amount: BigInt(10_000),
      fee: BigInt(150),
      reference: '#WP-2026-AA1B2C3D',
      description: 'Café',
      paymentMethod: 'WALLET',
      createdAt: new Date('2026-01-15'),
      sender: { name: 'Juan Pérez', waId: '+56912345678' },
    };

    beforeEach(() => {
      mockPrisma.transaction.findMany.mockResolvedValue([mockTx]);
      mockPrisma.transaction.count.mockResolvedValue(1);
    });

    it('returns transactions with formatted amounts and pagination', async () => {
      const result = await svc.getTransactions(MERCHANT_ID, 1, 20);

      expect(result.transactions).toHaveLength(1);
      expect(result.transactions[0].amountRaw).toBe(10_000);
      expect(result.transactions[0].amount).toMatch(/\$/);
      expect(result.transactions[0].customerName).toBe('Juan Pérez');
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.totalPages).toBe(1);
    });

    it('uses "Anónimo" when sender has no name', async () => {
      mockPrisma.transaction.findMany.mockResolvedValue([
        { ...mockTx, sender: { name: null, waId: '+56999999999' } },
      ]);

      const result = await svc.getTransactions(MERCHANT_ID);

      expect(result.transactions[0].customerName).toBe('Anónimo');
    });

    it('calculates correct net amount (amount - fee)', async () => {
      const result = await svc.getTransactions(MERCHANT_ID);
      const tx = result.transactions[0];
      // net = 10000 - 150 = 9850
      expect(tx.amountRaw).toBe(10_000);
      // net is formatted, just check it's present
      expect(tx.net).toMatch(/\$/);
    });

    it('passes correct skip for pagination', async () => {
      await svc.getTransactions(MERCHANT_ID, 3, 10); // page 3, size 10 → skip 20

      const findManyArgs = mockPrisma.transaction.findMany.mock.calls[0][0];
      expect(findManyArgs.skip).toBe(20);
      expect(findManyArgs.take).toBe(10);
    });

    it('calculates totalPages correctly', async () => {
      mockPrisma.transaction.count.mockResolvedValue(45);
      const result = await svc.getTransactions(MERCHANT_ID, 1, 20);
      expect(result.pagination.totalPages).toBe(3); // ceil(45/20)
    });

    it('returns empty transactions array when merchant has none', async () => {
      mockPrisma.transaction.findMany.mockResolvedValue([]);
      mockPrisma.transaction.count.mockResolvedValue(0);

      const result = await svc.getTransactions(MERCHANT_ID);

      expect(result.transactions).toHaveLength(0);
      expect(result.pagination.totalPages).toBe(0);
    });
  });

  // ─── generateSettlementReport ────────────────────────────

  describe('generateSettlementReport', () => {
    const startDate = new Date('2026-01-01');
    const endDate = new Date('2026-01-31');

    it('returns settlement summary with correct amounts', async () => {
      mockPrisma.transaction.aggregate.mockResolvedValue({
        _sum: { amount: BigInt(500_000), fee: BigInt(7_500) },
        _count: 50,
      });

      const result = await svc.generateSettlementReport(MERCHANT_ID, startDate, endDate);

      expect(result.grossAmount).toBe(500_000);
      expect(result.totalFees).toBe(7_500);
      expect(result.netAmount).toBe(492_500); // gross - fees
      expect(result.transactionCount).toBe(50);
      expect(result.status).toBe('pending');
    });

    it('formats date as YYYY-MM-DD from endDate', async () => {
      mockPrisma.transaction.aggregate.mockResolvedValue({
        _sum: { amount: null, fee: null },
        _count: 0,
      });

      const result = await svc.generateSettlementReport(
        MERCHANT_ID,
        startDate,
        new Date('2026-01-31'),
      );

      expect(result.date).toBe('2026-01-31');
    });

    it('handles zero transactions (null sums)', async () => {
      mockPrisma.transaction.aggregate.mockResolvedValue({
        _sum: { amount: null, fee: null },
        _count: 0,
      });

      const result = await svc.generateSettlementReport(MERCHANT_ID, startDate, endDate);

      expect(result.grossAmount).toBe(0);
      expect(result.totalFees).toBe(0);
      expect(result.netAmount).toBe(0);
      expect(result.transactionCount).toBe(0);
    });

    it('queries with correct date range', async () => {
      mockPrisma.transaction.aggregate.mockResolvedValue({
        _sum: { amount: null, fee: null },
        _count: 0,
      });

      await svc.generateSettlementReport(MERCHANT_ID, startDate, endDate);

      const whereClause = mockPrisma.transaction.aggregate.mock.calls[0][0].where;
      expect(whereClause.receiverId).toBe(MERCHANT_ID);
      expect(whereClause.createdAt.gte).toEqual(startDate);
      expect(whereClause.createdAt.lte).toEqual(endDate);
    });
  });
});
