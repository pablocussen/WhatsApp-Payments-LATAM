/**
 * Tests for AuditService — immutable financial event log.
 */

const mockAuditEvent = {
  create: jest.fn(),
  findMany: jest.fn(),
  count: jest.fn(),
};

jest.mock('../../src/config/database', () => ({
  prisma: { auditEvent: mockAuditEvent },
}));

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test' },
}));

import { AuditService, audit } from '../../src/services/audit.service';

describe('AuditService', () => {
  beforeEach(() => jest.clearAllMocks());

  // ─── log() ────────────────────────────────────────────

  describe('log()', () => {
    it('creates an audit event with all fields', () => {
      mockAuditEvent.create.mockResolvedValue({});

      audit.log({
        eventType: 'PAYMENT_COMPLETED',
        actorType: 'USER',
        actorId: 'user-1',
        targetUserId: 'user-1',
        amount: 5000,
        transactionId: 'tx-1',
        metadata: { reference: '#WP-2026-ABC', fee: 0 },
      });

      expect(mockAuditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'PAYMENT_COMPLETED',
          actorType: 'USER',
          actorId: 'user-1',
          targetUserId: 'user-1',
          amount: BigInt(5000),
          transactionId: 'tx-1',
          status: 'SUCCESS',
          errorMessage: null,
          metadata: { reference: '#WP-2026-ABC', fee: 0 },
        }),
      });
    });

    it('handles null optional fields', () => {
      mockAuditEvent.create.mockResolvedValue({});

      audit.log({
        eventType: 'ACCOUNT_LOCKED',
        actorType: 'SYSTEM',
      });

      expect(mockAuditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          eventType: 'ACCOUNT_LOCKED',
          actorType: 'SYSTEM',
          actorId: null,
          targetUserId: null,
          amount: null,
          transactionId: null,
        }),
      });
    });

    it('sets status and errorMessage when provided', () => {
      mockAuditEvent.create.mockResolvedValue({});

      audit.log({
        eventType: 'PAYMENT_FAILED',
        actorType: 'SYSTEM',
        targetUserId: 'user-1',
        amount: 1000,
        status: 'FAILED',
        errorMessage: 'Saldo insuficiente.',
      });

      expect(mockAuditEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'FAILED',
          errorMessage: 'Saldo insuficiente.',
        }),
      });
    });

    it('does not throw when create fails (fire-and-forget)', async () => {
      mockAuditEvent.create.mockRejectedValue(new Error('DB down'));

      // Should not throw
      audit.log({
        eventType: 'USER_CREATED',
        actorType: 'SYSTEM',
        targetUserId: 'user-1',
      });

      // Wait for the promise to settle
      await new Promise((r) => setTimeout(r, 10));
      expect(mockAuditEvent.create).toHaveBeenCalled();
    });
  });

  // ─── query() ──────────────────────────────────────────

  describe('query()', () => {
    const sampleEvent = {
      id: 'evt-1',
      eventType: 'PAYMENT_COMPLETED',
      actorType: 'USER',
      actorId: 'user-1',
      targetUserId: 'user-1',
      amount: BigInt(5000),
      metadata: { reference: '#WP-2026-ABC' },
      status: 'SUCCESS',
      errorMessage: null,
      transactionId: 'tx-1',
      createdAt: new Date('2026-03-09T12:00:00Z'),
    };

    it('returns paginated events with BigInt converted to Number', async () => {
      mockAuditEvent.findMany.mockResolvedValue([sampleEvent]);
      mockAuditEvent.count.mockResolvedValue(1);

      const result = await audit.query({});

      expect(result.total).toBe(1);
      expect(result.events[0].amount).toBe(5000);
      expect(typeof result.events[0].amount).toBe('number');
    });

    it('filters by userId', async () => {
      mockAuditEvent.findMany.mockResolvedValue([]);
      mockAuditEvent.count.mockResolvedValue(0);

      await audit.query({ userId: 'user-1' });

      expect(mockAuditEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { targetUserId: 'user-1' },
        }),
      );
    });

    it('filters by eventType', async () => {
      mockAuditEvent.findMany.mockResolvedValue([]);
      mockAuditEvent.count.mockResolvedValue(0);

      await audit.query({ eventType: 'PAYMENT_BLOCKED' });

      expect(mockAuditEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { eventType: 'PAYMENT_BLOCKED' },
        }),
      );
    });

    it('respects pagination params', async () => {
      mockAuditEvent.findMany.mockResolvedValue([]);
      mockAuditEvent.count.mockResolvedValue(0);

      await audit.query({ page: 3, pageSize: 10 });

      expect(mockAuditEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 10,
        }),
      );
    });

    it('clamps pageSize to 100 max', async () => {
      mockAuditEvent.findMany.mockResolvedValue([]);
      mockAuditEvent.count.mockResolvedValue(0);

      await audit.query({ pageSize: 500 });

      expect(mockAuditEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it('handles null amount in events', async () => {
      mockAuditEvent.findMany.mockResolvedValue([{ ...sampleEvent, amount: null }]);
      mockAuditEvent.count.mockResolvedValue(1);

      const result = await audit.query({});
      expect(result.events[0].amount).toBeNull();
    });
  });

  // ─── singleton ────────────────────────────────────────

  it('exports a singleton instance', () => {
    expect(audit).toBeInstanceOf(AuditService);
  });
});
