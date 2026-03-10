/**
 * Unit tests for SettlementService.
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

import { SettlementService } from '../../src/services/settlement.service';
import type { Settlement, MerchantSettlementConfig } from '../../src/services/settlement.service';

describe('SettlementService', () => {
  let svc: SettlementService;

  beforeEach(() => {
    svc = new SettlementService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
  });

  // ─── setConfig ────────────────────────────────────────

  describe('setConfig', () => {
    const validConfig = {
      merchantId: 'm-1',
      frequency: 'weekly' as const,
      bankName: 'Banco Estado',
      accountNumber: '12345678',
      accountType: 'corriente' as const,
      holderName: 'Juan Pérez',
      holderRut: '12345678-5',
    };

    it('creates settlement config', async () => {
      const config = await svc.setConfig(validConfig);
      expect(config.merchantId).toBe('m-1');
      expect(config.frequency).toBe('weekly');
      expect(config.minimumAmount).toBe(10000); // default
      expect(config.bankName).toBe('Banco Estado');
      expect(config.active).toBe(true);
    });

    it('uses custom minimum amount', async () => {
      const config = await svc.setConfig({ ...validConfig, minimumAmount: 50000 });
      expect(config.minimumAmount).toBe(50000);
    });

    it('saves to Redis', async () => {
      await svc.setConfig(validConfig);
      expect(mockRedisSet).toHaveBeenCalledWith(
        'settlement:config:m-1',
        expect.any(String),
        { EX: 365 * 24 * 60 * 60 },
      );
    });

    it('rejects empty bank name', async () => {
      await expect(svc.setConfig({ ...validConfig, bankName: '' }))
        .rejects.toThrow('banco');
    });

    it('rejects empty account number', async () => {
      await expect(svc.setConfig({ ...validConfig, accountNumber: '' }))
        .rejects.toThrow('cuenta');
    });

    it('rejects empty holder name', async () => {
      await expect(svc.setConfig({ ...validConfig, holderName: '' }))
        .rejects.toThrow('titular');
    });

    it('rejects invalid RUT', async () => {
      await expect(svc.setConfig({ ...validConfig, holderRut: '123' }))
        .rejects.toThrow('RUT');
    });

    it('rejects negative minimum amount', async () => {
      await expect(svc.setConfig({ ...validConfig, minimumAmount: -1 }))
        .rejects.toThrow('negativo');
    });
  });

  // ─── getConfig ────────────────────────────────────────

  describe('getConfig', () => {
    it('returns stored config', async () => {
      const config: MerchantSettlementConfig = {
        merchantId: 'm-1', frequency: 'daily', minimumAmount: 10000,
        bankName: 'BancoEstado', accountNumber: '123', accountType: 'corriente',
        holderName: 'Juan', holderRut: '12345678-5', active: true,
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(config));
      const result = await svc.getConfig('m-1');
      expect(result).not.toBeNull();
      expect(result!.bankName).toBe('BancoEstado');
    });

    it('returns null when not set', async () => {
      expect(await svc.getConfig('m-unknown')).toBeNull();
    });

    it('returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.getConfig('m-1')).toBeNull();
    });
  });

  // ─── createSettlement ─────────────────────────────────

  describe('createSettlement', () => {
    const validInput = {
      merchantId: 'm-1',
      amount: 500000,
      fee: 15000,
      transactionCount: 42,
      periodStart: '2026-03-01',
      periodEnd: '2026-03-07',
    };

    it('creates settlement with stl_ prefix', async () => {
      const s = await svc.createSettlement(validInput);
      expect(s.id).toMatch(/^stl_[0-9a-f]{16}$/);
      expect(s.amount).toBe(500000);
      expect(s.fee).toBe(15000);
      expect(s.netAmount).toBe(485000);
      expect(s.status).toBe('pending');
      expect(s.processedAt).toBeNull();
    });

    it('attaches bank account from config', async () => {
      const config: MerchantSettlementConfig = {
        merchantId: 'm-1', frequency: 'weekly', minimumAmount: 10000,
        bankName: 'BancoEstado', accountNumber: '99887766', accountType: 'corriente',
        holderName: 'Juan', holderRut: '12345678-5', active: true,
      };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(config)); // getConfig
      mockRedisGet.mockResolvedValueOnce(null); // merchant index

      const s = await svc.createSettlement(validInput);
      expect(s.bankAccount).toBe('99887766');
    });

    it('rejects non-positive amount', async () => {
      await expect(svc.createSettlement({ ...validInput, amount: 0 }))
        .rejects.toThrow('positivo');
    });

    it('rejects negative fee', async () => {
      await expect(svc.createSettlement({ ...validInput, fee: -1 }))
        .rejects.toThrow('negativa');
    });

    it('rejects negative transaction count', async () => {
      await expect(svc.createSettlement({ ...validInput, transactionCount: -1 }))
        .rejects.toThrow('inválido');
    });
  });

  // ─── getSettlement ────────────────────────────────────

  describe('getSettlement', () => {
    it('returns stored settlement', async () => {
      const s: Settlement = {
        id: 'stl_1', merchantId: 'm-1', amount: 100000, fee: 3000,
        netAmount: 97000, transactionCount: 10, periodStart: '2026-03-01',
        periodEnd: '2026-03-07', status: 'pending', bankAccount: null,
        transferReference: null, createdAt: '2026-03-08', processedAt: null,
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(s));
      const result = await svc.getSettlement('stl_1');
      expect(result).not.toBeNull();
      expect(result!.netAmount).toBe(97000);
    });

    it('returns null when not found', async () => {
      expect(await svc.getSettlement('stl_unknown')).toBeNull();
    });

    it('returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.getSettlement('stl_1')).toBeNull();
    });
  });

  // ─── getMerchantSettlements ───────────────────────────

  describe('getMerchantSettlements', () => {
    it('returns settlements for merchant', async () => {
      const s: Settlement = {
        id: 'stl_1', merchantId: 'm-1', amount: 100000, fee: 3000,
        netAmount: 97000, transactionCount: 10, periodStart: '2026-03-01',
        periodEnd: '2026-03-07', status: 'completed', bankAccount: null,
        transferReference: 'TRF-001', createdAt: '2026-03-08', processedAt: '2026-03-09',
      };
      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'settlement:merchant:m-1') return Promise.resolve(JSON.stringify(['stl_1']));
        if (key === 'settlement:stl_1') return Promise.resolve(JSON.stringify(s));
        return Promise.resolve(null);
      });

      const result = await svc.getMerchantSettlements('m-1');
      expect(result).toHaveLength(1);
    });

    it('returns empty when none', async () => {
      expect(await svc.getMerchantSettlements('m-none')).toEqual([]);
    });

    it('returns empty on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.getMerchantSettlements('m-1')).toEqual([]);
    });
  });

  // ─── processSettlement ────────────────────────────────

  describe('processSettlement', () => {
    it('completes a pending settlement', async () => {
      const s: Settlement = {
        id: 'stl_p1', merchantId: 'm-1', amount: 100000, fee: 3000,
        netAmount: 97000, transactionCount: 10, periodStart: '2026-03-01',
        periodEnd: '2026-03-07', status: 'pending', bankAccount: '12345678',
        transferReference: null, createdAt: '2026-03-08', processedAt: null,
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(s));

      const result = await svc.processSettlement('stl_p1', 'TRF-2026-001');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('completed');
      expect(result!.transferReference).toBe('TRF-2026-001');
      expect(result!.processedAt).not.toBeNull();
    });

    it('throws when not pending', async () => {
      const s: Settlement = {
        id: 'stl_c1', merchantId: 'm-1', amount: 100000, fee: 3000,
        netAmount: 97000, transactionCount: 10, periodStart: '2026-03-01',
        periodEnd: '2026-03-07', status: 'completed', bankAccount: null,
        transferReference: 'TRF-X', createdAt: '2026-03-08', processedAt: '2026-03-09',
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(s));

      await expect(svc.processSettlement('stl_c1', 'TRF-NEW'))
        .rejects.toThrow('No se puede procesar');
    });

    it('returns null for unknown settlement', async () => {
      expect(await svc.processSettlement('stl_unknown', 'TRF-X')).toBeNull();
    });

    it('returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      expect(await svc.processSettlement('stl_1', 'TRF-X')).toBeNull();
    });
  });

  // ─── cancelSettlement ─────────────────────────────────

  describe('cancelSettlement', () => {
    it('cancels a pending settlement', async () => {
      const s: Settlement = {
        id: 'stl_can', merchantId: 'm-1', amount: 50000, fee: 1500,
        netAmount: 48500, transactionCount: 5, periodStart: '2026-03-01',
        periodEnd: '2026-03-07', status: 'pending', bankAccount: null,
        transferReference: null, createdAt: '2026-03-08', processedAt: null,
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(s));

      const result = await svc.cancelSettlement('stl_can', 'Merchant request');
      expect(result).not.toBeNull();
      expect(result!.status).toBe('cancelled');
    });

    it('throws when not pending', async () => {
      const s: Settlement = {
        id: 'stl_done', merchantId: 'm-1', amount: 50000, fee: 1500,
        netAmount: 48500, transactionCount: 5, periodStart: '2026-03-01',
        periodEnd: '2026-03-07', status: 'completed', bankAccount: null,
        transferReference: 'TRF-X', createdAt: '2026-03-08', processedAt: '2026-03-09',
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(s));

      await expect(svc.cancelSettlement('stl_done', 'test'))
        .rejects.toThrow('No se puede cancelar');
    });

    it('returns null for unknown settlement', async () => {
      expect(await svc.cancelSettlement('stl_unknown', 'test')).toBeNull();
    });
  });

  // ─── getPendingSummary ────────────────────────────────

  describe('getPendingSummary', () => {
    it('summarizes pending settlements', async () => {
      const settlements: Settlement[] = [
        { id: 'stl_1', merchantId: 'm-1', amount: 100000, fee: 3000, netAmount: 97000, transactionCount: 10, periodStart: '2026-03-01', periodEnd: '2026-03-07', status: 'pending', bankAccount: null, transferReference: null, createdAt: '2026-03-08', processedAt: null },
        { id: 'stl_2', merchantId: 'm-1', amount: 200000, fee: 6000, netAmount: 194000, transactionCount: 20, periodStart: '2026-03-08', periodEnd: '2026-03-14', status: 'pending', bankAccount: null, transferReference: null, createdAt: '2026-03-15', processedAt: null },
        { id: 'stl_3', merchantId: 'm-1', amount: 50000, fee: 1500, netAmount: 48500, transactionCount: 5, periodStart: '2026-02-01', periodEnd: '2026-02-28', status: 'completed', bankAccount: null, transferReference: 'TRF', createdAt: '2026-03-01', processedAt: '2026-03-02' },
      ];

      mockRedisGet.mockImplementation((key: string) => {
        if (key === 'settlement:merchant:m-1') return Promise.resolve(JSON.stringify(['stl_1', 'stl_2', 'stl_3']));
        const s = settlements.find((x) => `settlement:${x.id}` === key);
        return Promise.resolve(s ? JSON.stringify(s) : null);
      });

      const summary = await svc.getPendingSummary('m-1');
      expect(summary.count).toBe(2);
      expect(summary.totalAmount).toBe(300000);
      expect(summary.totalFees).toBe(9000);
      expect(summary.totalNet).toBe(291000);
    });

    it('returns zeros when no pending', async () => {
      const summary = await svc.getPendingSummary('m-empty');
      expect(summary.count).toBe(0);
      expect(summary.totalAmount).toBe(0);
    });
  });
});
