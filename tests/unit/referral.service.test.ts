/**
 * Unit tests for ReferralService.
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

import { ReferralService } from '../../src/services/referral.service';
import type { ReferralCode, Referral } from '../../src/services/referral.service';

describe('ReferralService', () => {
  let svc: ReferralService;

  beforeEach(() => {
    svc = new ReferralService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
  });

  // ─── generateCode ─────────────────────────────────────

  describe('generateCode', () => {
    it('generates code with WP prefix', async () => {
      const code = await svc.generateCode('u1');
      expect(code.code).toMatch(/^WP[0-9A-F]{8}$/);
      expect(code.userId).toBe('u1');
      expect(code.usageCount).toBe(0);
      expect(code.maxUses).toBe(50);
      expect(code.active).toBe(true);
    });

    it('returns existing code if user already has one', async () => {
      const existing: ReferralCode = {
        code: 'WPABCDEF12', userId: 'u1', createdAt: '2026-01-01',
        usageCount: 5, maxUses: 50, rewardPerReferral: 1000,
        rewardForReferred: 500, active: true,
      };
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'referral:user:u1') return Promise.resolve('WPABCDEF12');
        if (key === 'referral:code:WPABCDEF12') return Promise.resolve(JSON.stringify(existing));
        return Promise.resolve(null);
      });

      const code = await svc.generateCode('u1');
      expect(code.code).toBe('WPABCDEF12');
      expect(code.usageCount).toBe(5);
    });

    it('saves code to Redis', async () => {
      await svc.generateCode('u1');
      expect(mockRedisSet).toHaveBeenCalledWith(
        expect.stringMatching(/^referral:code:WP/),
        expect.any(String),
        { EX: 365 * 24 * 60 * 60 },
      );
      expect(mockRedisSet).toHaveBeenCalledWith(
        'referral:user:u1',
        expect.stringMatching(/^WP/),
        { EX: 365 * 24 * 60 * 60 },
      );
    });

    it('does not throw on Redis error', async () => {
      mockRedisSet.mockRejectedValue(new Error('Redis down'));
      const code = await svc.generateCode('u1');
      expect(code.code).toBeDefined();
    });
  });

  // ─── getCode ──────────────────────────────────────────

  describe('getCode', () => {
    it('returns stored code', async () => {
      const rc: ReferralCode = {
        code: 'WPTEST1234', userId: 'u1', createdAt: '2026-01-01',
        usageCount: 0, maxUses: 50, rewardPerReferral: 1000,
        rewardForReferred: 500, active: true,
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(rc));
      const result = await svc.getCode('WPTEST1234');
      expect(result).not.toBeNull();
      expect(result!.code).toBe('WPTEST1234');
    });

    it('returns null when not found', async () => {
      expect(await svc.getCode('INVALID')).toBeNull();
    });

    it('returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.getCode('WPTEST1234')).toBeNull();
    });
  });

  // ─── getUserCode ──────────────────────────────────────

  describe('getUserCode', () => {
    it('returns user code via lookup', async () => {
      const rc: ReferralCode = {
        code: 'WP11223344', userId: 'u1', createdAt: '2026-01-01',
        usageCount: 0, maxUses: 50, rewardPerReferral: 1000,
        rewardForReferred: 500, active: true,
      };
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'referral:user:u1') return Promise.resolve('WP11223344');
        if (key === 'referral:code:WP11223344') return Promise.resolve(JSON.stringify(rc));
        return Promise.resolve(null);
      });

      const result = await svc.getUserCode('u1');
      expect(result).not.toBeNull();
      expect(result!.code).toBe('WP11223344');
    });

    it('returns null when user has no code', async () => {
      expect(await svc.getUserCode('u-none')).toBeNull();
    });
  });

  // ─── applyCode ────────────────────────────────────────

  describe('applyCode', () => {
    const validCode: ReferralCode = {
      code: 'WPVALID123', userId: 'referrer-1', createdAt: '2026-01-01',
      usageCount: 0, maxUses: 50, rewardPerReferral: 1000,
      rewardForReferred: 500, active: true,
    };

    it('applies code successfully', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'referral:code:WPVALID123') return Promise.resolve(JSON.stringify(validCode));
        return Promise.resolve(null);
      });

      const result = await svc.applyCode('WPVALID123', 'new-user-1');
      expect(result.success).toBe(true);
      expect(result.referral).toBeDefined();
      expect(result.referral!.id).toMatch(/^ref_/);
      expect(result.referral!.referrerId).toBe('referrer-1');
      expect(result.referral!.referredId).toBe('new-user-1');
      expect(result.referral!.status).toBe('pending');
    });

    it('rejects unknown code', async () => {
      const result = await svc.applyCode('INVALID', 'new-user-1');
      expect(result.success).toBe(false);
      expect(result.message).toContain('no encontrado');
    });

    it('rejects inactive code', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'referral:code:WPINACTIVE') return Promise.resolve(JSON.stringify({ ...validCode, code: 'WPINACTIVE', active: false }));
        return Promise.resolve(null);
      });

      const result = await svc.applyCode('WPINACTIVE', 'new-user-1');
      expect(result.success).toBe(false);
      expect(result.message).toContain('inactivo');
    });

    it('rejects when max uses reached', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'referral:code:WPFULL1234') return Promise.resolve(JSON.stringify({ ...validCode, code: 'WPFULL1234', usageCount: 50 }));
        return Promise.resolve(null);
      });

      const result = await svc.applyCode('WPFULL1234', 'new-user-1');
      expect(result.success).toBe(false);
      expect(result.message).toContain('máximo');
    });

    it('rejects self-referral', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'referral:code:WPVALID123') return Promise.resolve(JSON.stringify(validCode));
        return Promise.resolve(null);
      });

      const result = await svc.applyCode('WPVALID123', 'referrer-1');
      expect(result.success).toBe(false);
      expect(result.message).toContain('propio código');
    });

    it('rejects when user already referred', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'referral:code:WPVALID123') return Promise.resolve(JSON.stringify(validCode));
        if (key === 'referral:referred-by:already-referred') return Promise.resolve('ref_old');
        return Promise.resolve(null);
      });

      const result = await svc.applyCode('WPVALID123', 'already-referred');
      expect(result.success).toBe(false);
      expect(result.message).toContain('Ya has usado');
    });

    it('increments usage count', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'referral:code:WPVALID123') return Promise.resolve(JSON.stringify(validCode));
        return Promise.resolve(null);
      });

      await svc.applyCode('WPVALID123', 'new-user-1');
      const codeSetCalls = mockRedisSet.mock.calls.filter(
        (c: unknown[]) => (c[0] as string) === 'referral:code:WPVALID123',
      );
      expect(codeSetCalls.length).toBeGreaterThanOrEqual(1);
      const saved = JSON.parse(codeSetCalls[0][1] as string);
      expect(saved.usageCount).toBe(1);
    });
  });

  // ─── completeReferral ─────────────────────────────────

  describe('completeReferral', () => {
    it('completes a pending referral', async () => {
      const referral: Referral = {
        id: 'ref_1', code: 'WPTEST', referrerId: 'u1', referredId: 'u2',
        status: 'pending', referrerReward: 1000, referredReward: 500,
        createdAt: '2026-01-01', completedAt: null,
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(referral));

      const result = await svc.completeReferral('ref_1');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('completed');
      expect(result!.completedAt).not.toBeNull();
    });

    it('returns null for non-pending referral', async () => {
      const referral: Referral = {
        id: 'ref_done', code: 'WP', referrerId: 'u1', referredId: 'u2',
        status: 'completed', referrerReward: 1000, referredReward: 500,
        createdAt: '2026-01-01', completedAt: '2026-01-02',
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(referral));
      expect(await svc.completeReferral('ref_done')).toBeNull();
    });

    it('returns null for unknown referral', async () => {
      expect(await svc.completeReferral('ref_unknown')).toBeNull();
    });

    it('returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.completeReferral('ref_1')).toBeNull();
    });
  });

  // ─── getUserReferrals ─────────────────────────────────

  describe('getUserReferrals', () => {
    it('returns referrals list', async () => {
      const referral: Referral = {
        id: 'ref_1', code: 'WP', referrerId: 'u1', referredId: 'u2',
        status: 'completed', referrerReward: 1000, referredReward: 500,
        createdAt: '2026-01-01', completedAt: '2026-01-02',
      };
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'referral:list:u1') return Promise.resolve(JSON.stringify(['ref_1']));
        if (key === 'referral:entry:ref_1') return Promise.resolve(JSON.stringify(referral));
        return Promise.resolve(null);
      });

      const result = await svc.getUserReferrals('u1');
      expect(result).toHaveLength(1);
    });

    it('returns empty when none', async () => {
      expect(await svc.getUserReferrals('u-none')).toEqual([]);
    });

    it('returns empty on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.getUserReferrals('u1')).toEqual([]);
    });
  });

  // ─── getStats ─────────────────────────────────────────

  describe('getStats', () => {
    it('calculates referral stats', async () => {
      const referrals: Referral[] = [
        { id: 'ref_1', code: 'WP', referrerId: 'u1', referredId: 'u2', status: 'completed', referrerReward: 1000, referredReward: 500, createdAt: '2026-01-01', completedAt: '2026-01-02' },
        { id: 'ref_2', code: 'WP', referrerId: 'u1', referredId: 'u3', status: 'completed', referrerReward: 1000, referredReward: 500, createdAt: '2026-01-01', completedAt: '2026-01-03' },
        { id: 'ref_3', code: 'WP', referrerId: 'u1', referredId: 'u4', status: 'pending', referrerReward: 1000, referredReward: 500, createdAt: '2026-01-01', completedAt: null },
      ];
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'referral:list:u1') return Promise.resolve(JSON.stringify(['ref_1', 'ref_2', 'ref_3']));
        const r = referrals.find((x) => `referral:entry:${x.id}` === key);
        return Promise.resolve(r ? JSON.stringify(r) : null);
      });

      const stats = await svc.getStats('u1');
      expect(stats.totalReferrals).toBe(3);
      expect(stats.completedReferrals).toBe(2);
      expect(stats.pendingReferrals).toBe(1);
      expect(stats.totalEarned).toBe(2000);
    });

    it('returns zeros when no referrals', async () => {
      const stats = await svc.getStats('u-none');
      expect(stats.totalReferrals).toBe(0);
      expect(stats.totalEarned).toBe(0);
    });
  });

  // ─── deactivateCode ───────────────────────────────────

  describe('deactivateCode', () => {
    it('deactivates user code', async () => {
      const rc: ReferralCode = {
        code: 'WPDEACT123', userId: 'u1', createdAt: '2026-01-01',
        usageCount: 3, maxUses: 50, rewardPerReferral: 1000,
        rewardForReferred: 500, active: true,
      };
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'referral:user:u1') return Promise.resolve('WPDEACT123');
        if (key === 'referral:code:WPDEACT123') return Promise.resolve(JSON.stringify(rc));
        return Promise.resolve(null);
      });

      const result = await svc.deactivateCode('u1');
      expect(result).toBe(true);
    });

    it('returns false when user has no code', async () => {
      expect(await svc.deactivateCode('u-none')).toBe(false);
    });

    it('returns false on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.deactivateCode('u1')).toBe(false);
    });
  });
});
