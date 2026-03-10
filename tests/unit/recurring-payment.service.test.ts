/**
 * Unit tests for RecurringPaymentService.
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

import { RecurringPaymentService } from '../../src/services/recurring-payment.service';
import type { RecurringPlan } from '../../src/services/recurring-payment.service';

describe('RecurringPaymentService', () => {
  let svc: RecurringPaymentService;

  beforeEach(() => {
    svc = new RecurringPaymentService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
  });

  // ─── createPlan ────────────────────────────────────────

  describe('createPlan', () => {
    const validInput = {
      merchantId: 'm-1',
      subscriberId: 'uid-1',
      amount: 10000,
      frequency: 'monthly' as const,
      description: 'Plan básico',
    };

    it('creates a plan with sub_ prefix', async () => {
      const plan = await svc.createPlan(validInput);
      expect(plan.id).toMatch(/^sub_[0-9a-f]{16}$/);
      expect(plan.merchantId).toBe('m-1');
      expect(plan.subscriberId).toBe('uid-1');
      expect(plan.amount).toBe(10000);
      expect(plan.frequency).toBe('monthly');
      expect(plan.status).toBe('active');
      expect(plan.chargeCount).toBe(0);
      expect(plan.totalCharged).toBe(0);
      expect(plan.lastChargedAt).toBeNull();
      expect(plan.nextChargeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('stores plan in Redis with TTL', async () => {
      await svc.createPlan(validInput);
      expect(mockRedisSet).toHaveBeenCalledWith(
        expect.stringMatching(/^recurring:plans:sub_/),
        expect.any(String),
        { EX: 365 * 24 * 60 * 60 },
      );
    });

    it('indexes plan by subscriber', async () => {
      await svc.createPlan(validInput);
      expect(mockRedisSet).toHaveBeenCalledWith(
        'recurring:user:uid-1',
        expect.any(String),
        { EX: 365 * 24 * 60 * 60 },
      );
    });

    it('rejects amount below 100', async () => {
      await expect(svc.createPlan({ ...validInput, amount: 50 }))
        .rejects.toThrow('Monto mínimo');
    });

    it('rejects amount above 50M', async () => {
      await expect(svc.createPlan({ ...validInput, amount: 50_000_001 }))
        .rejects.toThrow('Monto máximo');
    });

    it('rejects empty description', async () => {
      await expect(svc.createPlan({ ...validInput, description: '' }))
        .rejects.toThrow('Descripción debe tener');
    });

    it('rejects description over 100 chars', async () => {
      await expect(svc.createPlan({ ...validInput, description: 'x'.repeat(101) }))
        .rejects.toThrow('Descripción debe tener');
    });

    it('rejects when max plans reached', async () => {
      const ids = Array.from({ length: 10 }, (_, i) => `sub_plan${i}`);
      mockRedisGet
        .mockResolvedValueOnce(JSON.stringify(ids)) // getUserPlans index
        .mockResolvedValue(JSON.stringify({
          id: 'sub_plan0', merchantId: 'm-1', subscriberId: 'uid-1',
          amount: 5000, frequency: 'monthly', description: 'Test',
          status: 'active', nextChargeDate: '2026-04-01',
          createdAt: '2026-01-01', lastChargedAt: null, totalCharged: 0, chargeCount: 0,
        }));

      await expect(svc.createPlan(validInput)).rejects.toThrow('Máximo 10');
    });

    it('does not throw on Redis save error', async () => {
      mockRedisSet.mockRejectedValue(new Error('Redis down'));
      const plan = await svc.createPlan(validInput);
      expect(plan.id).toBeDefined();
    });
  });

  // ─── getPlan ───────────────────────────────────────────

  describe('getPlan', () => {
    it('returns plan by ID', async () => {
      const stored: RecurringPlan = {
        id: 'sub_abc', merchantId: 'm-1', subscriberId: 'uid-1',
        amount: 10000, frequency: 'monthly', description: 'Test',
        status: 'active', nextChargeDate: '2026-04-01',
        createdAt: '2026-01-01', lastChargedAt: null, totalCharged: 0, chargeCount: 0,
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(stored));

      const plan = await svc.getPlan('sub_abc');
      expect(plan).not.toBeNull();
      expect(plan!.amount).toBe(10000);
    });

    it('returns null for unknown ID', async () => {
      const plan = await svc.getPlan('sub_unknown');
      expect(plan).toBeNull();
    });

    it('returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const plan = await svc.getPlan('sub_abc');
      expect(plan).toBeNull();
    });
  });

  // ─── getUserPlans ──────────────────────────────────────

  describe('getUserPlans', () => {
    it('returns all plans for a user', async () => {
      const plan1: RecurringPlan = {
        id: 'sub_1', merchantId: 'm-1', subscriberId: 'uid-1',
        amount: 5000, frequency: 'weekly', description: 'Plan A',
        status: 'active', nextChargeDate: '2026-03-16',
        createdAt: '2026-01-01', lastChargedAt: null, totalCharged: 0, chargeCount: 0,
      };

      mockRedisGet
        .mockResolvedValueOnce(JSON.stringify(['sub_1'])) // index
        .mockResolvedValueOnce(JSON.stringify(plan1));     // plan detail

      const plans = await svc.getUserPlans('uid-1');
      expect(plans).toHaveLength(1);
      expect(plans[0].id).toBe('sub_1');
    });

    it('returns empty when no plans', async () => {
      const plans = await svc.getUserPlans('uid-1');
      expect(plans).toEqual([]);
    });

    it('returns empty on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const plans = await svc.getUserPlans('uid-1');
      expect(plans).toEqual([]);
    });
  });

  // ─── pausePlan / resumePlan / cancelPlan ───────────────

  describe('pausePlan', () => {
    const activePlan: RecurringPlan = {
      id: 'sub_1', merchantId: 'm-1', subscriberId: 'uid-1',
      amount: 10000, frequency: 'monthly', description: 'Test',
      status: 'active', nextChargeDate: '2026-04-01',
      createdAt: '2026-01-01', lastChargedAt: null, totalCharged: 0, chargeCount: 0,
    };

    it('pauses an active plan', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(activePlan));
      const result = await svc.pausePlan('sub_1', 'uid-1');
      expect(result).toBe(true);
      const saved = JSON.parse(mockRedisSet.mock.calls[0][1]) as RecurringPlan;
      expect(saved.status).toBe('paused');
    });

    it('returns false for wrong subscriber', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify(activePlan));
      const result = await svc.pausePlan('sub_1', 'uid-other');
      expect(result).toBe(false);
    });

    it('returns false for already paused plan', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ ...activePlan, status: 'paused' }));
      const result = await svc.pausePlan('sub_1', 'uid-1');
      expect(result).toBe(false);
    });

    it('returns false for unknown plan', async () => {
      const result = await svc.pausePlan('sub_unknown', 'uid-1');
      expect(result).toBe(false);
    });
  });

  describe('resumePlan', () => {
    it('resumes a paused plan with new next date', async () => {
      const paused: RecurringPlan = {
        id: 'sub_1', merchantId: 'm-1', subscriberId: 'uid-1',
        amount: 10000, frequency: 'weekly', description: 'Test',
        status: 'paused', nextChargeDate: '2026-03-01',
        createdAt: '2026-01-01', lastChargedAt: null, totalCharged: 0, chargeCount: 0,
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(paused));

      const result = await svc.resumePlan('sub_1', 'uid-1');
      expect(result).toBe(true);
      const saved = JSON.parse(mockRedisSet.mock.calls[0][1]) as RecurringPlan;
      expect(saved.status).toBe('active');
      expect(saved.nextChargeDate).not.toBe('2026-03-01'); // updated
    });

    it('returns false for active plan', async () => {
      const active: RecurringPlan = {
        id: 'sub_1', merchantId: 'm-1', subscriberId: 'uid-1',
        amount: 10000, frequency: 'monthly', description: 'Test',
        status: 'active', nextChargeDate: '2026-04-01',
        createdAt: '2026-01-01', lastChargedAt: null, totalCharged: 0, chargeCount: 0,
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(active));

      const result = await svc.resumePlan('sub_1', 'uid-1');
      expect(result).toBe(false);
    });
  });

  describe('cancelPlan', () => {
    it('cancels an active plan', async () => {
      const plan: RecurringPlan = {
        id: 'sub_1', merchantId: 'm-1', subscriberId: 'uid-1',
        amount: 10000, frequency: 'monthly', description: 'Test',
        status: 'active', nextChargeDate: '2026-04-01',
        createdAt: '2026-01-01', lastChargedAt: null, totalCharged: 0, chargeCount: 0,
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(plan));

      const result = await svc.cancelPlan('sub_1', 'uid-1');
      expect(result).toBe(true);
      const saved = JSON.parse(mockRedisSet.mock.calls[0][1]) as RecurringPlan;
      expect(saved.status).toBe('cancelled');
    });

    it('cancels a paused plan', async () => {
      const plan: RecurringPlan = {
        id: 'sub_1', merchantId: 'm-1', subscriberId: 'uid-1',
        amount: 10000, frequency: 'monthly', description: 'Test',
        status: 'paused', nextChargeDate: '2026-04-01',
        createdAt: '2026-01-01', lastChargedAt: null, totalCharged: 0, chargeCount: 0,
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(plan));

      const result = await svc.cancelPlan('sub_1', 'uid-1');
      expect(result).toBe(true);
    });

    it('returns false for already cancelled plan', async () => {
      const plan: RecurringPlan = {
        id: 'sub_1', merchantId: 'm-1', subscriberId: 'uid-1',
        amount: 10000, frequency: 'monthly', description: 'Test',
        status: 'cancelled', nextChargeDate: '2026-04-01',
        createdAt: '2026-01-01', lastChargedAt: null, totalCharged: 0, chargeCount: 0,
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(plan));

      const result = await svc.cancelPlan('sub_1', 'uid-1');
      expect(result).toBe(false);
    });
  });

  // ─── recordCharge ──────────────────────────────────────

  describe('recordCharge', () => {
    it('records charge and updates counters', async () => {
      const plan: RecurringPlan = {
        id: 'sub_1', merchantId: 'm-1', subscriberId: 'uid-1',
        amount: 10000, frequency: 'monthly', description: 'Test',
        status: 'active', nextChargeDate: '2026-03-09',
        createdAt: '2026-01-01', lastChargedAt: null, totalCharged: 20000, chargeCount: 2,
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(plan));

      const result = await svc.recordCharge('sub_1');
      expect(result).not.toBeNull();
      expect(result!.chargeCount).toBe(3);
      expect(result!.totalCharged).toBe(30000);
      expect(result!.lastChargedAt).not.toBeNull();
    });

    it('returns null for paused plan', async () => {
      const plan: RecurringPlan = {
        id: 'sub_1', merchantId: 'm-1', subscriberId: 'uid-1',
        amount: 10000, frequency: 'monthly', description: 'Test',
        status: 'paused', nextChargeDate: '2026-03-09',
        createdAt: '2026-01-01', lastChargedAt: null, totalCharged: 0, chargeCount: 0,
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(plan));

      const result = await svc.recordCharge('sub_1');
      expect(result).toBeNull();
    });

    it('returns null for unknown plan', async () => {
      const result = await svc.recordCharge('sub_unknown');
      expect(result).toBeNull();
    });
  });

  // ─── getDuePlans ───────────────────────────────────────

  describe('getDuePlans', () => {
    it('returns plans with nextChargeDate <= today', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

      const plan1: RecurringPlan = {
        id: 'sub_1', merchantId: 'm-1', subscriberId: 'uid-1',
        amount: 5000, frequency: 'weekly', description: 'Due',
        status: 'active', nextChargeDate: yesterday,
        createdAt: '2026-01-01', lastChargedAt: null, totalCharged: 0, chargeCount: 0,
      };
      const plan2: RecurringPlan = {
        id: 'sub_2', merchantId: 'm-1', subscriberId: 'uid-1',
        amount: 5000, frequency: 'monthly', description: 'Future',
        status: 'active', nextChargeDate: tomorrow,
        createdAt: '2026-01-01', lastChargedAt: null, totalCharged: 0, chargeCount: 0,
      };
      const plan3: RecurringPlan = {
        id: 'sub_3', merchantId: 'm-1', subscriberId: 'uid-1',
        amount: 5000, frequency: 'weekly', description: 'Due today',
        status: 'active', nextChargeDate: today,
        createdAt: '2026-01-01', lastChargedAt: null, totalCharged: 0, chargeCount: 0,
      };

      mockRedisGet
        .mockResolvedValueOnce(JSON.stringify(['sub_1', 'sub_2', 'sub_3'])) // index
        .mockResolvedValueOnce(JSON.stringify(plan1))
        .mockResolvedValueOnce(JSON.stringify(plan2))
        .mockResolvedValueOnce(JSON.stringify(plan3));

      const due = await svc.getDuePlans('uid-1');
      expect(due).toHaveLength(2);
      expect(due.map((p) => p.id)).toContain('sub_1');
      expect(due.map((p) => p.id)).toContain('sub_3');
    });

    it('excludes paused plans', async () => {
      const paused: RecurringPlan = {
        id: 'sub_1', merchantId: 'm-1', subscriberId: 'uid-1',
        amount: 5000, frequency: 'weekly', description: 'Paused',
        status: 'paused', nextChargeDate: '2020-01-01',
        createdAt: '2026-01-01', lastChargedAt: null, totalCharged: 0, chargeCount: 0,
      };

      mockRedisGet
        .mockResolvedValueOnce(JSON.stringify(['sub_1']))
        .mockResolvedValueOnce(JSON.stringify(paused));

      const due = await svc.getDuePlans('uid-1');
      expect(due).toHaveLength(0);
    });
  });

  // ─── computeNextDate ───────────────────────────────────

  describe('computeNextDate', () => {
    it('adds 7 days for weekly', () => {
      const base = new Date('2026-03-09');
      const next = svc.computeNextDate('weekly', base);
      expect(next).toBe('2026-03-16');
    });

    it('adds 14 days for biweekly', () => {
      const base = new Date('2026-03-09');
      const next = svc.computeNextDate('biweekly', base);
      expect(next).toBe('2026-03-23');
    });

    it('adds 1 month for monthly', () => {
      const base = new Date('2026-03-09');
      const next = svc.computeNextDate('monthly', base);
      expect(next).toBe('2026-04-09');
    });
  });
});
