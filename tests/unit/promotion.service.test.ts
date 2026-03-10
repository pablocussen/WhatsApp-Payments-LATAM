/**
 * Unit tests for PromotionService.
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

import { PromotionService } from '../../src/services/promotion.service';
import type { Promotion } from '../../src/services/promotion.service';

describe('PromotionService', () => {
  let svc: PromotionService;

  beforeEach(() => {
    svc = new PromotionService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
  });

  const futureDate = new Date(Date.now() + 30 * 86400000).toISOString();
  const pastDate = new Date(Date.now() - 30 * 86400000).toISOString();
  const now = new Date().toISOString();

  // ─── createPromotion ──────────────────────────────────

  describe('createPromotion', () => {
    const validInput = {
      name: '10% Off',
      type: 'percentage' as const,
      value: 10,
      startDate: pastDate,
      endDate: futureDate,
    };

    it('creates promotion with prm_ prefix', async () => {
      const p = await svc.createPromotion(validInput);
      expect(p.id).toMatch(/^prm_[0-9a-f]{16}$/);
      expect(p.name).toBe('10% Off');
      expect(p.type).toBe('percentage');
      expect(p.value).toBe(10);
      expect(p.active).toBe(true);
      expect(p.usageCount).toBe(0);
      expect(p.scope).toBe('global');
    });

    it('uses custom options', async () => {
      const p = await svc.createPromotion({
        ...validInput,
        description: 'Test promo',
        minAmount: 5000,
        maxDiscount: 2000,
        scope: 'merchant',
        scopeId: 'm-1',
        code: 'VERANO2026',
        usageLimit: 100,
        perUserLimit: 3,
      });
      expect(p.description).toBe('Test promo');
      expect(p.minAmount).toBe(5000);
      expect(p.maxDiscount).toBe(2000);
      expect(p.scope).toBe('merchant');
      expect(p.scopeId).toBe('m-1');
      expect(p.code).toBe('VERANO2026');
      expect(p.usageLimit).toBe(100);
      expect(p.perUserLimit).toBe(3);
    });

    it('saves code lookup in Redis', async () => {
      await svc.createPromotion({ ...validInput, code: 'PROMO10' });
      const codeCalls = mockRedisSet.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).startsWith('promo:code:'),
      );
      expect(codeCalls).toHaveLength(1);
      expect(codeCalls[0][0]).toBe('promo:code:PROMO10');
    });

    it('rejects empty name', async () => {
      await expect(svc.createPromotion({ ...validInput, name: '' }))
        .rejects.toThrow('Nombre');
    });

    it('rejects invalid type', async () => {
      await expect(svc.createPromotion({ ...validInput, type: 'bogo' as never }))
        .rejects.toThrow('Tipo inválido');
    });

    it('rejects non-positive value', async () => {
      await expect(svc.createPromotion({ ...validInput, value: 0 }))
        .rejects.toThrow('positivo');
    });

    it('rejects percentage > 100', async () => {
      await expect(svc.createPromotion({ ...validInput, value: 150 }))
        .rejects.toThrow('100%');
    });

    it('rejects end before start', async () => {
      await expect(svc.createPromotion({ ...validInput, startDate: futureDate, endDate: pastDate }))
        .rejects.toThrow('posterior');
    });

    it('rejects invalid scope', async () => {
      await expect(svc.createPromotion({ ...validInput, scope: 'city' as never }))
        .rejects.toThrow('Alcance inválido');
    });
  });

  // ─── getPromotion ─────────────────────────────────────

  describe('getPromotion', () => {
    it('returns stored promotion', async () => {
      const p: Promotion = {
        id: 'prm_1', name: 'Test', description: '', type: 'fixed', value: 500,
        minAmount: 0, maxDiscount: 0, scope: 'global', scopeId: null,
        code: null, usageLimit: 0, usageCount: 0, perUserLimit: 0,
        startDate: pastDate, endDate: futureDate, active: true, createdAt: now,
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(p));
      const result = await svc.getPromotion('prm_1');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Test');
    });

    it('returns null when not found', async () => {
      expect(await svc.getPromotion('prm_unknown')).toBeNull();
    });

    it('returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.getPromotion('prm_1')).toBeNull();
    });
  });

  // ─── findByCode ───────────────────────────────────────

  describe('findByCode', () => {
    it('finds promotion by code (case-insensitive)', async () => {
      const p: Promotion = {
        id: 'prm_c1', name: 'Code Promo', description: '', type: 'percentage', value: 15,
        minAmount: 0, maxDiscount: 0, scope: 'global', scopeId: null,
        code: 'VERANO', usageLimit: 0, usageCount: 0, perUserLimit: 0,
        startDate: pastDate, endDate: futureDate, active: true, createdAt: now,
      };
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'promo:code:VERANO') return Promise.resolve('prm_c1');
        if (key === 'promo:prm_c1') return Promise.resolve(JSON.stringify(p));
        return Promise.resolve(null);
      });

      const result = await svc.findByCode('verano');
      expect(result).not.toBeNull();
      expect(result!.code).toBe('VERANO');
    });

    it('returns null for unknown code', async () => {
      expect(await svc.findByCode('INVALID')).toBeNull();
    });
  });

  // ─── applyPromotion ───────────────────────────────────

  describe('applyPromotion', () => {
    const basePromo: Promotion = {
      id: 'prm_a1', name: '10% Off', description: '', type: 'percentage', value: 10,
      minAmount: 1000, maxDiscount: 5000, scope: 'global', scopeId: null,
      code: null, usageLimit: 100, usageCount: 5, perUserLimit: 3,
      startDate: pastDate, endDate: futureDate, active: true, createdAt: now,
    };

    it('applies percentage discount', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'promo:prm_a1') return Promise.resolve(JSON.stringify(basePromo));
        return Promise.resolve(null);
      });

      const result = await svc.applyPromotion('prm_a1', 'u1', 20000);
      expect(result).not.toBeNull();
      expect(result!.discount).toBe(2000); // 10% of 20000
      expect(result!.finalAmount).toBe(18000);
    });

    it('caps percentage at maxDiscount', async () => {
      const promo = { ...basePromo, maxDiscount: 1000 };
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'promo:prm_a1') return Promise.resolve(JSON.stringify(promo));
        return Promise.resolve(null);
      });

      const result = await svc.applyPromotion('prm_a1', 'u1', 50000);
      expect(result!.discount).toBe(1000); // capped
    });

    it('applies fixed discount', async () => {
      const promo: Promotion = {
        ...basePromo, type: 'fixed', value: 500, maxDiscount: 0,
      };
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'promo:prm_a1') return Promise.resolve(JSON.stringify(promo));
        return Promise.resolve(null);
      });

      const result = await svc.applyPromotion('prm_a1', 'u1', 5000);
      expect(result!.discount).toBe(500);
      expect(result!.finalAmount).toBe(4500);
    });

    it('fixed discount does not exceed amount', async () => {
      const promo: Promotion = {
        ...basePromo, type: 'fixed', value: 10000, minAmount: 0,
      };
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'promo:prm_a1') return Promise.resolve(JSON.stringify(promo));
        return Promise.resolve(null);
      });

      const result = await svc.applyPromotion('prm_a1', 'u1', 3000);
      expect(result!.discount).toBe(3000); // capped to amount
    });

    it('returns null for inactive promo', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'promo:prm_a1') return Promise.resolve(JSON.stringify({ ...basePromo, active: false }));
        return Promise.resolve(null);
      });
      expect(await svc.applyPromotion('prm_a1', 'u1', 5000)).toBeNull();
    });

    it('returns null when below minAmount', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'promo:prm_a1') return Promise.resolve(JSON.stringify(basePromo));
        return Promise.resolve(null);
      });
      expect(await svc.applyPromotion('prm_a1', 'u1', 500)).toBeNull(); // min is 1000
    });

    it('returns null when usage limit reached', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'promo:prm_a1') return Promise.resolve(JSON.stringify({ ...basePromo, usageCount: 100 }));
        return Promise.resolve(null);
      });
      expect(await svc.applyPromotion('prm_a1', 'u1', 5000)).toBeNull();
    });

    it('returns null when per-user limit reached', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'promo:prm_a1') return Promise.resolve(JSON.stringify(basePromo));
        if (key === 'promo:usage:prm_a1:u1') return Promise.resolve('3'); // at limit
        return Promise.resolve(null);
      });
      expect(await svc.applyPromotion('prm_a1', 'u1', 5000)).toBeNull();
    });

    it('returns null for expired promo', async () => {
      const expired = { ...basePromo, endDate: pastDate, startDate: new Date(Date.now() - 60 * 86400000).toISOString() };
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'promo:prm_a1') return Promise.resolve(JSON.stringify(expired));
        return Promise.resolve(null);
      });
      expect(await svc.applyPromotion('prm_a1', 'u1', 5000)).toBeNull();
    });

    it('returns null for unknown promo', async () => {
      expect(await svc.applyPromotion('prm_unknown', 'u1', 5000)).toBeNull();
    });

    it('increments usage count', async () => {
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'promo:prm_a1') return Promise.resolve(JSON.stringify(basePromo));
        return Promise.resolve(null);
      });

      await svc.applyPromotion('prm_a1', 'u1', 5000);
      const promoCalls = mockRedisSet.mock.calls.filter(
        (c: unknown[]) => c[0] === 'promo:prm_a1',
      );
      expect(promoCalls.length).toBeGreaterThanOrEqual(1);
      const saved = JSON.parse(promoCalls[0][1] as string);
      expect(saved.usageCount).toBe(6);
    });
  });

  // ─── listActive ───────────────────────────────────────

  describe('listActive', () => {
    it('returns active non-expired promotions', async () => {
      const promos: Promotion[] = [
        { id: 'prm_1', name: 'Active', description: '', type: 'fixed', value: 100, minAmount: 0, maxDiscount: 0, scope: 'global', scopeId: null, code: null, usageLimit: 0, usageCount: 0, perUserLimit: 0, startDate: pastDate, endDate: futureDate, active: true, createdAt: now },
        { id: 'prm_2', name: 'Inactive', description: '', type: 'fixed', value: 100, minAmount: 0, maxDiscount: 0, scope: 'global', scopeId: null, code: null, usageLimit: 0, usageCount: 0, perUserLimit: 0, startDate: pastDate, endDate: futureDate, active: false, createdAt: now },
      ];
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'promo:index') return Promise.resolve(JSON.stringify(['prm_1', 'prm_2']));
        const p = promos.find((x) => `promo:${x.id}` === key);
        return Promise.resolve(p ? JSON.stringify(p) : null);
      });

      const result = await svc.listActive();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Active');
    });

    it('returns empty when none', async () => {
      expect(await svc.listActive()).toEqual([]);
    });

    it('returns empty on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.listActive()).toEqual([]);
    });
  });

  // ─── deactivatePromotion ──────────────────────────────

  describe('deactivatePromotion', () => {
    it('deactivates a promotion', async () => {
      const p: Promotion = {
        id: 'prm_d1', name: 'Test', description: '', type: 'fixed', value: 100,
        minAmount: 0, maxDiscount: 0, scope: 'global', scopeId: null,
        code: null, usageLimit: 0, usageCount: 0, perUserLimit: 0,
        startDate: pastDate, endDate: futureDate, active: true, createdAt: now,
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(p));
      expect(await svc.deactivatePromotion('prm_d1')).toBe(true);
    });

    it('returns false for unknown promo', async () => {
      expect(await svc.deactivatePromotion('prm_unknown')).toBe(false);
    });

    it('returns false on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.deactivatePromotion('prm_1')).toBe(false);
    });
  });

  // ─── getUsageStats ────────────────────────────────────

  describe('getUsageStats', () => {
    it('returns usage statistics', async () => {
      const p: Promotion = {
        id: 'prm_s1', name: 'Test', description: '', type: 'fixed', value: 100,
        minAmount: 0, maxDiscount: 0, scope: 'global', scopeId: null,
        code: null, usageLimit: 100, usageCount: 42, perUserLimit: 0,
        startDate: pastDate, endDate: futureDate, active: true, createdAt: now,
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(p));

      const stats = await svc.getUsageStats('prm_s1');
      expect(stats).not.toBeNull();
      expect(stats!.totalUses).toBe(42);
      expect(stats!.remaining).toBe(58);
    });

    it('returns -1 remaining for unlimited', async () => {
      const p: Promotion = {
        id: 'prm_s2', name: 'Unlimited', description: '', type: 'fixed', value: 100,
        minAmount: 0, maxDiscount: 0, scope: 'global', scopeId: null,
        code: null, usageLimit: 0, usageCount: 10, perUserLimit: 0,
        startDate: pastDate, endDate: futureDate, active: true, createdAt: now,
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(p));

      const stats = await svc.getUsageStats('prm_s2');
      expect(stats!.remaining).toBe(-1);
    });

    it('returns null for unknown promo', async () => {
      expect(await svc.getUsageStats('prm_unknown')).toBeNull();
    });
  });
});
