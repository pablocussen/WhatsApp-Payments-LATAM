/**
 * Unit tests for DisputeService.
 * Redis is fully mocked.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test' },
}));

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  }),
}));

import { DisputeService } from '../../src/services/dispute.service';
import type { Dispute } from '../../src/services/dispute.service';

describe('DisputeService', () => {
  let svc: DisputeService;

  beforeEach(() => {
    svc = new DisputeService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
  });

  // ─── openDispute ───────────────────────────────────────

  describe('openDispute', () => {
    const validInput = {
      transactionRef: '#WP-ABC123',
      openedBy: 'uid-1',
      reason: 'unauthorized' as const,
      description: 'No reconozco este cobro',
    };

    it('creates a dispute with dsp_ prefix', async () => {
      const dispute = await svc.openDispute(validInput);
      expect(dispute.id).toMatch(/^dsp_[0-9a-f]{16}$/);
      expect(dispute.transactionRef).toBe('#WP-ABC123');
      expect(dispute.openedBy).toBe('uid-1');
      expect(dispute.reason).toBe('unauthorized');
      expect(dispute.status).toBe('open');
      expect(dispute.resolution).toBeNull();
      expect(dispute.resolvedAt).toBeNull();
    });

    it('stores dispute in Redis', async () => {
      await svc.openDispute(validInput);
      expect(mockRedisSet).toHaveBeenCalledWith(
        expect.stringMatching(/^dispute:dsp_/),
        expect.any(String),
        { EX: 180 * 24 * 60 * 60 },
      );
    });

    it('adds to user index', async () => {
      await svc.openDispute(validInput);
      // Third set call: user index (first=dispute, second=index read miss, third=index write)
      const indexCall = mockRedisSet.mock.calls.find(
        (c: unknown[]) => (c[0] as string).startsWith('dispute:user:'),
      );
      expect(indexCall).toBeDefined();
    });

    it('sets merchantId when provided', async () => {
      const dispute = await svc.openDispute({ ...validInput, merchantId: 'm-1' });
      expect(dispute.merchantId).toBe('m-1');
    });

    it('sets merchantId to null when not provided', async () => {
      const dispute = await svc.openDispute(validInput);
      expect(dispute.merchantId).toBeNull();
    });

    it('rejects invalid reason', async () => {
      await expect(svc.openDispute({ ...validInput, reason: 'invalid' as never }))
        .rejects.toThrow('Razón de disputa inválida');
    });

    it('rejects empty description', async () => {
      await expect(svc.openDispute({ ...validInput, description: '' }))
        .rejects.toThrow('Descripción debe tener');
    });

    it('rejects description over 500 chars', async () => {
      await expect(svc.openDispute({ ...validInput, description: 'x'.repeat(501) }))
        .rejects.toThrow('Descripción debe tener');
    });

    it('rejects missing transaction reference', async () => {
      await expect(svc.openDispute({ ...validInput, transactionRef: '' }))
        .rejects.toThrow('Referencia de transacción requerida');
    });

    it('rejects when max open disputes reached', async () => {
      const ids = ['dsp_1', 'dsp_2', 'dsp_3', 'dsp_4', 'dsp_5'];
      const openDispute: Dispute = {
        id: 'dsp_1', transactionRef: '#WP-X', openedBy: 'uid-1',
        merchantId: null, reason: 'unauthorized', description: 'test',
        status: 'open', resolution: null,
        createdAt: '2026-01-01', updatedAt: '2026-01-01', resolvedAt: null,
      };

      mockRedisGet
        .mockResolvedValueOnce(JSON.stringify(ids)) // user index
        .mockResolvedValue(JSON.stringify(openDispute)); // each dispute

      await expect(svc.openDispute(validInput)).rejects.toThrow('Máximo 5 disputas abiertas');
    });

    it('rejects duplicate dispute on same transaction', async () => {
      const ids = ['dsp_1'];
      const existingDispute: Dispute = {
        id: 'dsp_1', transactionRef: '#WP-ABC123', openedBy: 'uid-1',
        merchantId: null, reason: 'unauthorized', description: 'existing',
        status: 'open', resolution: null,
        createdAt: '2026-01-01', updatedAt: '2026-01-01', resolvedAt: null,
      };

      mockRedisGet
        .mockResolvedValueOnce(JSON.stringify(ids))
        .mockResolvedValueOnce(JSON.stringify(existingDispute));

      await expect(svc.openDispute(validInput)).rejects.toThrow('Ya existe una disputa');
    });

    it('allows dispute if previous on same tx is closed', async () => {
      const ids = ['dsp_1'];
      const closedDispute: Dispute = {
        id: 'dsp_1', transactionRef: '#WP-ABC123', openedBy: 'uid-1',
        merchantId: null, reason: 'unauthorized', description: 'closed',
        status: 'closed', resolution: 'Resuelto',
        createdAt: '2026-01-01', updatedAt: '2026-01-01', resolvedAt: '2026-01-02',
      };

      mockRedisGet
        .mockResolvedValueOnce(JSON.stringify(ids))
        .mockResolvedValueOnce(JSON.stringify(closedDispute));

      const dispute = await svc.openDispute(validInput);
      expect(dispute.id).toBeDefined();
    });
  });

  // ─── getDispute ────────────────────────────────────────

  describe('getDispute', () => {
    it('returns dispute by ID', async () => {
      const stored: Dispute = {
        id: 'dsp_abc', transactionRef: '#WP-X', openedBy: 'uid-1',
        merchantId: null, reason: 'duplicate', description: 'test',
        status: 'open', resolution: null,
        createdAt: '2026-01-01', updatedAt: '2026-01-01', resolvedAt: null,
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(stored));

      const dispute = await svc.getDispute('dsp_abc');
      expect(dispute).not.toBeNull();
      expect(dispute!.reason).toBe('duplicate');
    });

    it('returns null for unknown ID', async () => {
      const dispute = await svc.getDispute('dsp_unknown');
      expect(dispute).toBeNull();
    });

    it('returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const dispute = await svc.getDispute('dsp_abc');
      expect(dispute).toBeNull();
    });
  });

  // ─── getUserDisputes ───────────────────────────────────

  describe('getUserDisputes', () => {
    it('returns all disputes for a user', async () => {
      const dispute1: Dispute = {
        id: 'dsp_1', transactionRef: '#WP-1', openedBy: 'uid-1',
        merchantId: null, reason: 'unauthorized', description: 'test',
        status: 'open', resolution: null,
        createdAt: '2026-01-01', updatedAt: '2026-01-01', resolvedAt: null,
      };

      mockRedisGet
        .mockResolvedValueOnce(JSON.stringify(['dsp_1']))
        .mockResolvedValueOnce(JSON.stringify(dispute1));

      const disputes = await svc.getUserDisputes('uid-1');
      expect(disputes).toHaveLength(1);
    });

    it('returns empty when no disputes', async () => {
      const disputes = await svc.getUserDisputes('uid-1');
      expect(disputes).toEqual([]);
    });

    it('returns empty on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const disputes = await svc.getUserDisputes('uid-1');
      expect(disputes).toEqual([]);
    });
  });

  // ─── updateStatus ──────────────────────────────────────

  describe('updateStatus', () => {
    const openDispute: Dispute = {
      id: 'dsp_1', transactionRef: '#WP-X', openedBy: 'uid-1',
      merchantId: 'm-1', reason: 'unauthorized', description: 'test',
      status: 'open', resolution: null,
      createdAt: '2026-01-01', updatedAt: '2026-01-01', resolvedAt: null,
    };

    it('moves to under_review', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(openDispute));

      const result = await svc.updateStatus('dsp_1', 'under_review');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('under_review');
    });

    it('resolves in favor of customer with resolution text', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(openDispute));

      const result = await svc.updateStatus('dsp_1', 'resolved_favor_customer', 'Reembolso procesado');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('resolved_favor_customer');
      expect(result!.resolution).toBe('Reembolso procesado');
      expect(result!.resolvedAt).not.toBeNull();
    });

    it('resolves in favor of merchant', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(openDispute));

      const result = await svc.updateStatus('dsp_1', 'resolved_favor_merchant', 'Cobro válido');
      expect(result!.status).toBe('resolved_favor_merchant');
      expect(result!.resolvedAt).not.toBeNull();
    });

    it('returns null for unknown dispute', async () => {
      const result = await svc.updateStatus('dsp_unknown', 'under_review');
      expect(result).toBeNull();
    });

    it('returns null for already closed dispute', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ ...openDispute, status: 'closed' }));
      const result = await svc.updateStatus('dsp_1', 'under_review');
      expect(result).toBeNull();
    });
  });

  // ─── closeDispute ──────────────────────────────────────

  describe('closeDispute', () => {
    it('closes with resolution text', async () => {
      const dispute: Dispute = {
        id: 'dsp_1', transactionRef: '#WP-X', openedBy: 'uid-1',
        merchantId: null, reason: 'other', description: 'test',
        status: 'under_review', resolution: null,
        createdAt: '2026-01-01', updatedAt: '2026-01-01', resolvedAt: null,
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(dispute));

      const result = await svc.closeDispute('dsp_1', 'Caso cerrado');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('closed');
      expect(result!.resolution).toBe('Caso cerrado');
      expect(result!.resolvedAt).not.toBeNull();
    });
  });
});
