/**
 * Unit tests for LoyaltyService.
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

import { LoyaltyService } from '../../src/services/loyalty.service';
import type { LoyaltyAccount, RewardItem } from '../../src/services/loyalty.service';

describe('LoyaltyService', () => {
  let svc: LoyaltyService;

  beforeEach(() => {
    svc = new LoyaltyService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
  });

  // ─── getAccount ─────────────────────────────────────────

  describe('getAccount', () => {
    it('returns stored account', async () => {
      const account: LoyaltyAccount = {
        userId: 'u1', points: 500, lifetimePoints: 1200,
        tier: 'BRONCE', lastEarnedAt: '2026-01-01', createdAt: '2025-01-01',
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(account));

      const result = await svc.getAccount('u1');
      expect(result.points).toBe(500);
      expect(result.tier).toBe('BRONCE');
    });

    it('returns default account when none stored', async () => {
      const result = await svc.getAccount('u-new');
      expect(result.userId).toBe('u-new');
      expect(result.points).toBe(0);
      expect(result.tier).toBe('BRONCE');
    });

    it('returns default on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const result = await svc.getAccount('u1');
      expect(result.points).toBe(0);
    });
  });

  // ─── earnPoints ─────────────────────────────────────────

  describe('earnPoints', () => {
    it('earns points based on amount (1 per $100 CLP)', async () => {
      const result = await svc.earnPoints('u1', 10000);
      // 10000 * 0.01 = 100 points, BRONCE multiplier 1.0 = 100
      expect(result.earned).toBe(100);
      expect(result.total).toBe(100);
      expect(result.tier).toBe('BRONCE');
      expect(result.tierChanged).toBe(false);
    });

    it('returns 0 for amount < 100', async () => {
      const result = await svc.earnPoints('u1', 50);
      expect(result.earned).toBe(0);
    });

    it('applies tier multiplier for PLATA', async () => {
      const account: LoyaltyAccount = {
        userId: 'u1', points: 1000, lifetimePoints: 6000,
        tier: 'PLATA', lastEarnedAt: null, createdAt: '2025-01-01',
      };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(account));

      const result = await svc.earnPoints('u1', 10000);
      // 100 * 1.25 = 125
      expect(result.earned).toBe(125);
    });

    it('applies tier multiplier for ORO', async () => {
      const account: LoyaltyAccount = {
        userId: 'u1', points: 2000, lifetimePoints: 30000,
        tier: 'ORO', lastEarnedAt: null, createdAt: '2025-01-01',
      };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(account));

      const result = await svc.earnPoints('u1', 10000);
      // 100 * 1.5 = 150
      expect(result.earned).toBe(150);
    });

    it('applies tier multiplier for PLATINO (2x)', async () => {
      const account: LoyaltyAccount = {
        userId: 'u1', points: 5000, lifetimePoints: 120000,
        tier: 'PLATINO', lastEarnedAt: null, createdAt: '2025-01-01',
      };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(account));

      const result = await svc.earnPoints('u1', 10000);
      // 100 * 2.0 = 200
      expect(result.earned).toBe(200);
    });

    it('detects tier upgrade', async () => {
      const account: LoyaltyAccount = {
        userId: 'u1', points: 400, lifetimePoints: 4900,
        tier: 'BRONCE', lastEarnedAt: null, createdAt: '2025-01-01',
      };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(account));

      // Earn 100 points → lifetime 5000 → PLATA
      const result = await svc.earnPoints('u1', 10000);
      expect(result.tierChanged).toBe(true);
      expect(result.tier).toBe('PLATA');
    });

    it('saves account and history to Redis', async () => {
      await svc.earnPoints('u1', 10000, '#WP-REF');
      expect(mockRedisSet).toHaveBeenCalledWith(
        'loyalty:u1',
        expect.any(String),
        { EX: 365 * 24 * 60 * 60 },
      );
      // History call
      expect(mockRedisSet).toHaveBeenCalledWith(
        'loyalty:history:u1',
        expect.any(String),
        { EX: 365 * 24 * 60 * 60 },
      );
    });

    it('does not throw on Redis error', async () => {
      mockRedisSet.mockRejectedValue(new Error('Redis down'));
      const result = await svc.earnPoints('u1', 10000);
      expect(result.earned).toBe(100);
    });
  });

  // ─── redeemPoints ───────────────────────────────────────

  describe('redeemPoints', () => {
    it('redeems points successfully', async () => {
      const account: LoyaltyAccount = {
        userId: 'u1', points: 500, lifetimePoints: 1000,
        tier: 'BRONCE', lastEarnedAt: null, createdAt: '2025-01-01',
      };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(account));

      const result = await svc.redeemPoints('u1', 200, 'Descuento $500');
      expect(result.success).toBe(true);
      expect(result.remaining).toBe(300);
      expect(result.message).toBe('Canje exitoso');
    });

    it('rejects when insufficient points', async () => {
      const account: LoyaltyAccount = {
        userId: 'u1', points: 100, lifetimePoints: 100,
        tier: 'BRONCE', lastEarnedAt: null, createdAt: '2025-01-01',
      };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(account));

      const result = await svc.redeemPoints('u1', 500);
      expect(result.success).toBe(false);
      expect(result.message).toContain('insuficientes');
    });

    it('rejects zero or negative points', async () => {
      const result = await svc.redeemPoints('u1', 0);
      expect(result.success).toBe(false);
      expect(result.message).toContain('inválida');
    });

    it('records redemption in history', async () => {
      const account: LoyaltyAccount = {
        userId: 'u1', points: 1000, lifetimePoints: 2000,
        tier: 'BRONCE', lastEarnedAt: null, createdAt: '2025-01-01',
      };
      mockRedisGet
        .mockResolvedValueOnce(JSON.stringify(account))  // getAccount
        .mockResolvedValueOnce(null);                      // history

      await svc.redeemPoints('u1', 300);
      const historyCalls = mockRedisSet.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).startsWith('loyalty:history:'),
      );
      expect(historyCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ─── addBonus ───────────────────────────────────────────

  describe('addBonus', () => {
    it('adds bonus points', async () => {
      const result = await svc.addBonus('u1', 500, 'Referido');
      expect(result.total).toBe(500);
    });

    it('can trigger tier upgrade', async () => {
      const account: LoyaltyAccount = {
        userId: 'u1', points: 200, lifetimePoints: 4800,
        tier: 'BRONCE', lastEarnedAt: null, createdAt: '2025-01-01',
      };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(account));

      const result = await svc.addBonus('u1', 500);
      expect(result.tierChanged).toBe(true);
      expect(result.tier).toBe('PLATA');
    });

    it('rejects non-positive points', async () => {
      await expect(svc.addBonus('u1', 0)).rejects.toThrow('positivos');
      await expect(svc.addBonus('u1', -10)).rejects.toThrow('positivos');
    });
  });

  // ─── getHistory ─────────────────────────────────────────

  describe('getHistory', () => {
    it('returns transaction history', async () => {
      const history = [
        { id: 'lpt_1', userId: 'u1', type: 'earn', points: 100, description: 'Test', reference: null, createdAt: '2026-01-01' },
        { id: 'lpt_2', userId: 'u1', type: 'redeem', points: -50, description: 'Canje', reference: null, createdAt: '2026-01-02' },
      ];
      mockRedisGet.mockResolvedValue(JSON.stringify(history));

      const result = await svc.getHistory('u1');
      expect(result).toHaveLength(2);
    });

    it('returns empty when no history', async () => {
      const result = await svc.getHistory('u1');
      expect(result).toEqual([]);
    });

    it('returns empty on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const result = await svc.getHistory('u1');
      expect(result).toEqual([]);
    });

    it('respects limit parameter', async () => {
      const history = Array.from({ length: 30 }, (_, i) => ({
        id: `lpt_${i}`, userId: 'u1', type: 'earn', points: 10,
        description: 'Test', reference: null, createdAt: '2026-01-01',
      }));
      mockRedisGet.mockResolvedValue(JSON.stringify(history));

      const result = await svc.getHistory('u1', 5);
      expect(result).toHaveLength(5);
    });
  });

  // ─── getTierInfo ────────────────────────────────────────

  describe('getTierInfo', () => {
    it('returns BRONCE tier info with next tier', async () => {
      const info = await svc.getTierInfo('u-new');
      expect(info.current).toBe('BRONCE');
      expect(info.multiplier).toBe(1.0);
      expect(info.nextTier).toBe('PLATA');
      expect(info.pointsToNext).toBe(5000);
    });

    it('returns PLATINO tier info (no next tier)', async () => {
      const account: LoyaltyAccount = {
        userId: 'u1', points: 10000, lifetimePoints: 150000,
        tier: 'PLATINO', lastEarnedAt: null, createdAt: '2025-01-01',
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(account));

      const info = await svc.getTierInfo('u1');
      expect(info.current).toBe('PLATINO');
      expect(info.multiplier).toBe(2.0);
      expect(info.nextTier).toBeNull();
      expect(info.pointsToNext).toBe(0);
    });

    it('calculates correct points to next tier', async () => {
      const account: LoyaltyAccount = {
        userId: 'u1', points: 300, lifetimePoints: 3000,
        tier: 'BRONCE', lastEarnedAt: null, createdAt: '2025-01-01',
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(account));

      const info = await svc.getTierInfo('u1');
      expect(info.pointsToNext).toBe(2000); // 5000 - 3000
    });
  });

  // ─── calculateTier ──────────────────────────────────────

  describe('calculateTier', () => {
    it('returns BRONCE for < 5000', () => {
      expect(svc.calculateTier(0)).toBe('BRONCE');
      expect(svc.calculateTier(4999)).toBe('BRONCE');
    });

    it('returns PLATA for >= 5000', () => {
      expect(svc.calculateTier(5000)).toBe('PLATA');
      expect(svc.calculateTier(24999)).toBe('PLATA');
    });

    it('returns ORO for >= 25000', () => {
      expect(svc.calculateTier(25000)).toBe('ORO');
      expect(svc.calculateTier(99999)).toBe('ORO');
    });

    it('returns PLATINO for >= 100000', () => {
      expect(svc.calculateTier(100000)).toBe('PLATINO');
      expect(svc.calculateTier(999999)).toBe('PLATINO');
    });
  });

  // ─── Rewards Catalog ────────────────────────────────────

  describe('addReward', () => {
    it('creates reward with rwd_ prefix', async () => {
      const reward = await svc.addReward({
        name: 'Descuento $500',
        description: '$500 de descuento en tu próximo pago',
        pointsCost: 200,
        category: 'descuentos',
      });
      expect(reward.id).toMatch(/^rwd_[0-9a-f]{16}$/);
      expect(reward.active).toBe(true);
      expect(reward.pointsCost).toBe(200);
    });

    it('rejects empty name', async () => {
      await expect(svc.addReward({
        name: '', description: 'test', pointsCost: 100, category: 'test',
      })).rejects.toThrow('Nombre inválido');
    });

    it('rejects name over 100 chars', async () => {
      await expect(svc.addReward({
        name: 'x'.repeat(101), description: 'test', pointsCost: 100, category: 'test',
      })).rejects.toThrow('Nombre inválido');
    });

    it('rejects pointsCost < 1', async () => {
      await expect(svc.addReward({
        name: 'Test', description: 'test', pointsCost: 0, category: 'test',
      })).rejects.toThrow('Costo en puntos');
    });
  });

  describe('getRewards', () => {
    it('returns active rewards', async () => {
      const rewards: RewardItem[] = [
        { id: 'rwd_1', name: 'A', description: 'a', pointsCost: 100, category: 'x', active: true },
        { id: 'rwd_2', name: 'B', description: 'b', pointsCost: 200, category: 'x', active: false },
      ];
      mockRedisGet.mockResolvedValue(JSON.stringify(rewards));

      const result = await svc.getRewards();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('rwd_1');
    });

    it('returns empty when none stored', async () => {
      const result = await svc.getRewards();
      expect(result).toEqual([]);
    });

    it('returns empty on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const result = await svc.getRewards();
      expect(result).toEqual([]);
    });
  });

  describe('deactivateReward', () => {
    it('deactivates a reward', async () => {
      const rewards: RewardItem[] = [
        { id: 'rwd_1', name: 'A', description: 'a', pointsCost: 100, category: 'x', active: true },
      ];
      mockRedisGet.mockResolvedValue(JSON.stringify(rewards));

      const result = await svc.deactivateReward('rwd_1');
      expect(result).toBe(true);
    });

    it('returns false for unknown reward', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify([]));
      const result = await svc.deactivateReward('rwd_unknown');
      expect(result).toBe(false);
    });

    it('returns false on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const result = await svc.deactivateReward('rwd_1');
      expect(result).toBe(false);
    });
  });
});
