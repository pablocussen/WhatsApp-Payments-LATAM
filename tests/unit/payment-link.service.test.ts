/**
 * Unit tests for PaymentLinkService.
 * Prisma is fully mocked — no DB or Redis required.
 */

jest.mock('../../src/config/environment', () => ({
  env: {
    NODE_ENV: 'test',
    PAYMENT_LINK_BASE_URL: 'https://whatpay.cl/c',
    ENCRYPTION_KEY_HEX: '0'.repeat(64),
  },
}));

const mockPrisma = {
  paymentLink: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  $executeRaw: jest.fn(),
};

jest.mock('../../src/config/database', () => ({ prisma: mockPrisma }));

import { PaymentLinkService } from '../../src/services/payment-link.service';

// ─── Helpers ─────────────────────────────────────────────

const MERCHANT_ID = 'merchant-uuid-001';
const LINK_ID = 'link-uuid-001';
const SHORT_CODE = 'abc123';

const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h from now
const pastDate = new Date(Date.now() - 1000); // 1s ago

function makeDbLink(overrides: Record<string, unknown> = {}) {
  return {
    id: LINK_ID,
    merchantId: MERCHANT_ID,
    shortCode: SHORT_CODE,
    amount: BigInt(10_000),
    description: 'Test cobro',
    expiresAt: futureDate,
    maxUses: 1,
    currentUses: 0,
    isActive: true,
    createdAt: new Date(),
    merchant: { name: 'Test Store', waId: '+56911111111' },
    ...overrides,
  };
}

// ─── Test Suite ──────────────────────────────────────────

describe('PaymentLinkService', () => {
  let svc: PaymentLinkService;

  beforeEach(() => {
    svc = new PaymentLinkService();
    jest.clearAllMocks();
  });

  // ─── createLink ─────────────────────────────────────────

  describe('createLink', () => {
    it('creates link and returns PaymentLinkInfo', async () => {
      const dbLink = makeDbLink();
      mockPrisma.paymentLink.create.mockResolvedValue(dbLink);

      const result = await svc.createLink({
        merchantId: MERCHANT_ID,
        amount: 10_000,
        description: 'Test cobro',
      });

      expect(result.merchantName).toBe('Test Store');
      expect(result.amount).toBe(10_000);
      expect(result.amountFormatted).toMatch(/\$/);
      expect(result.isActive).toBe(true);
      expect(result.usesRemaining).toBe(1); // maxUses=1, currentUses=0
      expect(result.url).toMatch(/^https:\/\/whatpay\.cl\/c\//);
    });

    it('stores amount as BigInt in DB', async () => {
      const dbLink = makeDbLink({ amount: BigInt(5_000) });
      mockPrisma.paymentLink.create.mockResolvedValue(dbLink);

      await svc.createLink({ merchantId: MERCHANT_ID, amount: 5_000 });

      const createData = mockPrisma.paymentLink.create.mock.calls[0][0].data;
      expect(typeof createData.amount).toBe('bigint');
      expect(createData.amount).toBe(BigInt(5_000));
    });

    it('allows open-amount link (no amount)', async () => {
      const dbLink = makeDbLink({ amount: null });
      mockPrisma.paymentLink.create.mockResolvedValue(dbLink);

      const result = await svc.createLink({ merchantId: MERCHANT_ID });

      expect(result.amount).toBeNull();
      expect(result.amountFormatted).toBeNull();
      const createData = mockPrisma.paymentLink.create.mock.calls[0][0].data;
      expect(createData.amount).toBeNull();
    });

    it('defaults to 24h expiry when none specified', async () => {
      mockPrisma.paymentLink.create.mockResolvedValue(makeDbLink());
      await svc.createLink({ merchantId: MERCHANT_ID });

      const expiresAt: Date = mockPrisma.paymentLink.create.mock.calls[0][0].data.expiresAt;
      const msFromNow = expiresAt.getTime() - Date.now();
      // Should be ~24h (±5s tolerance)
      expect(msFromNow).toBeGreaterThan(24 * 60 * 60 * 1000 - 5_000);
      expect(msFromNow).toBeLessThanOrEqual(24 * 60 * 60 * 1000 + 5_000);
    });

    it('respects custom expiresInHours', async () => {
      mockPrisma.paymentLink.create.mockResolvedValue(makeDbLink());
      await svc.createLink({ merchantId: MERCHANT_ID, expiresInHours: 2 });

      const expiresAt: Date = mockPrisma.paymentLink.create.mock.calls[0][0].data.expiresAt;
      const msFromNow = expiresAt.getTime() - Date.now();
      // Should be ~2h
      expect(msFromNow).toBeGreaterThan(2 * 60 * 60 * 1000 - 5_000);
      expect(msFromNow).toBeLessThanOrEqual(2 * 60 * 60 * 1000 + 5_000);
    });
  });

  // ─── resolveLink ────────────────────────────────────────

  describe('resolveLink', () => {
    it('returns null for unknown short code', async () => {
      mockPrisma.paymentLink.findUnique.mockResolvedValue(null);
      const result = await svc.resolveLink('nonexistent');
      expect(result).toBeNull();
    });

    it('returns null when link is expired', async () => {
      mockPrisma.paymentLink.findUnique.mockResolvedValue(makeDbLink({ expiresAt: pastDate }));
      const result = await svc.resolveLink(SHORT_CODE);
      expect(result).toBeNull();
    });

    it('returns null when max uses reached', async () => {
      mockPrisma.paymentLink.findUnique.mockResolvedValue(
        makeDbLink({ maxUses: 1, currentUses: 1 }),
      );
      const result = await svc.resolveLink(SHORT_CODE);
      expect(result).toBeNull();
    });

    it('returns null when link is inactive', async () => {
      mockPrisma.paymentLink.findUnique.mockResolvedValue(makeDbLink({ isActive: false }));
      const result = await svc.resolveLink(SHORT_CODE);
      expect(result).toBeNull();
    });

    it('returns PaymentLinkInfo for a valid link', async () => {
      mockPrisma.paymentLink.findUnique.mockResolvedValue(makeDbLink());
      const result = await svc.resolveLink(SHORT_CODE);

      expect(result).not.toBeNull();
      expect(result!.shortCode).toBe(SHORT_CODE);
      expect(result!.amount).toBe(10_000);
      expect(result!.usesRemaining).toBe(1);
      expect(result!.isActive).toBe(true);
    });

    it('returns link with no expiry (expiresAt = null)', async () => {
      mockPrisma.paymentLink.findUnique.mockResolvedValue(makeDbLink({ expiresAt: null }));
      const result = await svc.resolveLink(SHORT_CODE);
      expect(result).not.toBeNull();
      expect(result!.expiresAt).toBeNull();
    });

    it('converts BigInt amount to number in return value', async () => {
      mockPrisma.paymentLink.findUnique.mockResolvedValue(makeDbLink({ amount: BigInt(25_000) }));
      const result = await svc.resolveLink(SHORT_CODE);
      expect(result!.amount).toBe(25_000);
      expect(typeof result!.amount).toBe('number');
    });
  });

  // ─── incrementUse ───────────────────────────────────────

  describe('incrementUse', () => {
    it('returns true when row was updated (uses incremented)', async () => {
      mockPrisma.$executeRaw.mockResolvedValue(1);
      const result = await svc.incrementUse(LINK_ID);
      expect(result).toBe(true);
    });

    it('returns false when no row updated (already at max uses or inactive)', async () => {
      mockPrisma.$executeRaw.mockResolvedValue(0);
      const result = await svc.incrementUse(LINK_ID);
      expect(result).toBe(false);
    });
  });

  // ─── deactivateLink ─────────────────────────────────────

  describe('deactivateLink', () => {
    it('returns false when link not found', async () => {
      mockPrisma.paymentLink.findUnique.mockResolvedValue(null);
      const result = await svc.deactivateLink(LINK_ID, MERCHANT_ID);
      expect(result).toBe(false);
      expect(mockPrisma.paymentLink.update).not.toHaveBeenCalled();
    });

    it('returns false when merchantId does not match link owner', async () => {
      mockPrisma.paymentLink.findUnique.mockResolvedValue(
        makeDbLink({ merchantId: 'other-merchant' }),
      );
      const result = await svc.deactivateLink(LINK_ID, MERCHANT_ID);
      expect(result).toBe(false);
      expect(mockPrisma.paymentLink.update).not.toHaveBeenCalled();
    });

    it('deactivates link and returns true for correct owner', async () => {
      mockPrisma.paymentLink.findUnique.mockResolvedValue(makeDbLink());
      mockPrisma.paymentLink.update.mockResolvedValue({});

      const result = await svc.deactivateLink(LINK_ID, MERCHANT_ID);

      expect(result).toBe(true);
      const updateData = mockPrisma.paymentLink.update.mock.calls[0][0].data;
      expect(updateData.isActive).toBe(false);
    });
  });

  // ─── getMerchantLinks ────────────────────────────────────

  describe('getMerchantLinks', () => {
    it('returns empty array when merchant has no active links', async () => {
      mockPrisma.paymentLink.findMany.mockResolvedValue([]);
      const result = await svc.getMerchantLinks(MERCHANT_ID);
      expect(result).toEqual([]);
    });

    it('returns mapped PaymentLinkInfo array', async () => {
      mockPrisma.paymentLink.findMany.mockResolvedValue([
        makeDbLink({ shortCode: 'abc111', amount: BigInt(5_000) }),
        makeDbLink({ id: 'link-2', shortCode: 'def222', amount: BigInt(8_500) }),
      ]);

      const result = await svc.getMerchantLinks(MERCHANT_ID);

      expect(result).toHaveLength(2);
      expect(result[0].shortCode).toBe('abc111');
      expect(result[0].amount).toBe(5_000);
      expect(result[1].amount).toBe(8_500);
    });

    it('queries only active links', async () => {
      mockPrisma.paymentLink.findMany.mockResolvedValue([]);
      await svc.getMerchantLinks(MERCHANT_ID, 5);

      const queryArgs = mockPrisma.paymentLink.findMany.mock.calls[0][0];
      expect(queryArgs.where.merchantId).toBe(MERCHANT_ID);
      expect(queryArgs.where.isActive).toBe(true);
      expect(queryArgs.take).toBe(5);
    });
  });
});
