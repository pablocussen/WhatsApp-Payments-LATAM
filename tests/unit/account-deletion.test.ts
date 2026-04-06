/**
 * AccountDeletionService — GDPR/Ley 19.628 right to deletion.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisDel = jest.fn().mockResolvedValue(1);
const mockPrismaUserUpdate = jest.fn().mockResolvedValue({});
const mockAuditLog = jest.fn();

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
  }),
  prisma: {
    user: { update: (...args: unknown[]) => mockPrismaUserUpdate(...args) },
    $queryRaw: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../src/services/audit.service', () => ({
  audit: { log: (...args: unknown[]) => mockAuditLog(...args) },
}));

import { AccountDeletionService } from '../../src/services/account-deletion.service';

describe('AccountDeletionService', () => {
  let service: AccountDeletionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AccountDeletionService();
    mockRedisGet.mockResolvedValue(null);
  });

  // ── requestDeletion ────────────────────────────────

  describe('requestDeletion', () => {
    it('creates a deletion request with 7-day grace period', async () => {
      const req = await service.requestDeletion({
        userId: 'user-1', waId: '56912345678', reason: 'No longer needed',
      });

      expect(req.status).toBe('requested');
      expect(req.userId).toBe('user-1');
      expect(req.reason).toBe('No longer needed');
      expect(req.id).toMatch(/^del_/);

      const scheduled = new Date(req.scheduledAt);
      const requested = new Date(req.requestedAt);
      const diff = (scheduled.getTime() - requested.getTime()) / (1000 * 60 * 60 * 24);
      expect(Math.round(diff)).toBe(7);
    });

    it('stores request in Redis', async () => {
      await service.requestDeletion({ userId: 'user-1', waId: '56912345678' });
      expect(mockRedisSet).toHaveBeenCalledWith(
        'deletion:user-1',
        expect.any(String),
        { EX: 30 * 24 * 60 * 60 },
      );
    });

    it('logs audit event', async () => {
      await service.requestDeletion({ userId: 'user-1', waId: '56912345678' });
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'ACCOUNT_DELETION_REQUESTED' }),
      );
    });

    it('rejects duplicate request', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ status: 'requested' }));
      await expect(service.requestDeletion({
        userId: 'user-1', waId: '56912345678',
      })).rejects.toThrow('pendiente');
    });
  });

  // ── cancelDeletion ─────────────────────────────────

  describe('cancelDeletion', () => {
    it('cancels a pending request', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({
        status: 'requested', userId: 'user-1',
      }));

      const result = await service.cancelDeletion('user-1');
      expect(result).toBe(true);

      const stored = JSON.parse(mockRedisSet.mock.calls[0][1]);
      expect(stored.status).toBe('cancelled');
    });

    it('returns false if no pending request', async () => {
      mockRedisGet.mockResolvedValue(null);
      expect(await service.cancelDeletion('user-1')).toBe(false);
    });

    it('logs audit event', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ status: 'requested' }));
      await service.cancelDeletion('user-1');
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'ACCOUNT_DELETION_CANCELLED' }),
      );
    });
  });

  // ── processDeletion ────────────────────────────────

  describe('processDeletion', () => {
    it('processes deletion after grace period', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      mockRedisGet.mockResolvedValue(JSON.stringify({
        status: 'requested',
        userId: 'user-1',
        waId: '56912345678',
        scheduledAt: pastDate.toISOString(),
      }));

      const result = await service.processDeletion('user-1');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('completed');
      expect(result!.dataDeleted.length).toBeGreaterThan(0);
    });

    it('anonymizes user in database', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      mockRedisGet.mockResolvedValue(JSON.stringify({
        status: 'requested', userId: 'user-1', waId: '56912345678',
        scheduledAt: pastDate.toISOString(),
      }));

      await service.processDeletion('user-1');
      expect(mockPrismaUserUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({
            name: '[Eliminado]',
            rutHash: '[deleted]',
            pinHash: '[deleted]',
          }),
        }),
      );
    });

    it('deletes Redis keys (prefs, consents, session)', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      mockRedisGet.mockResolvedValue(JSON.stringify({
        status: 'requested', userId: 'user-1', waId: '56912345678',
        scheduledAt: pastDate.toISOString(),
      }));

      await service.processDeletion('user-1');
      expect(mockRedisDel).toHaveBeenCalled();
      const deletedKeys = mockRedisDel.mock.calls.map((c: string[]) => c[0]);
      expect(deletedKeys.some((k: string) => k.includes('prefs'))).toBe(true);
      expect(deletedKeys.some((k: string) => k.includes('consent'))).toBe(true);
    });

    it('does not process if grace period not passed', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 5);

      mockRedisGet.mockResolvedValue(JSON.stringify({
        status: 'requested', scheduledAt: futureDate.toISOString(),
      }));

      const result = await service.processDeletion('user-1');
      expect(result).toBeNull();
    });

    it('logs audit event on completion', async () => {
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);

      mockRedisGet.mockResolvedValue(JSON.stringify({
        status: 'requested', userId: 'user-1', waId: '56912345678',
        scheduledAt: pastDate.toISOString(),
      }));

      await service.processDeletion('user-1');
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ eventType: 'ACCOUNT_DELETION_COMPLETED' }),
      );
    });
  });

  // ── getPendingRequest ──────────────────────────────

  describe('getPendingRequest', () => {
    it('returns null when no request', async () => {
      expect(await service.getPendingRequest('user-1')).toBeNull();
    });

    it('returns null for cancelled requests', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ status: 'cancelled' }));
      expect(await service.getPendingRequest('user-1')).toBeNull();
    });

    it('returns null for completed requests', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ status: 'completed' }));
      expect(await service.getPendingRequest('user-1')).toBeNull();
    });

    it('returns active request', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ status: 'requested', userId: 'user-1' }));
      const req = await service.getPendingRequest('user-1');
      expect(req).not.toBeNull();
      expect(req!.status).toBe('requested');
    });
  });
});
