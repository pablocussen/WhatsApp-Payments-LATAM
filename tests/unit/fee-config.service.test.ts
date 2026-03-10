/**
 * Unit tests for FeeConfigService.
 * Redis is fully mocked.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisDel = jest.fn().mockResolvedValue(1);

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test' },
}));

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
  }),
}));

import { FeeConfigService } from '../../src/services/fee-config.service';
import type { FeeRule, FeeConfig } from '../../src/services/fee-config.service';

describe('FeeConfigService', () => {
  let svc: FeeConfigService;

  beforeEach(() => {
    svc = new FeeConfigService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRedisDel.mockResolvedValue(1);
  });

  // ─── calculateFee ──────────────────────────────────────

  describe('calculateFee', () => {
    it('calculates wallet fee (0% default)', async () => {
      const result = await svc.calculateFee(null, 10000, 'WALLET');
      expect(result.totalFee).toBe(0);
      expect(result.netAmount).toBe(10000);
    });

    it('calculates WebPay credit fee (2.8% + $50)', async () => {
      const result = await svc.calculateFee(null, 10000, 'WEBPAY_CREDIT');
      // 10000 * 2.8% = 280 + 50 = 330
      expect(result.totalFee).toBe(330);
      expect(result.netAmount).toBe(9670);
      expect(result.percentFee).toBe(2.8);
      expect(result.fixedFee).toBe(50);
    });

    it('calculates WebPay debit fee (1.8% + $50)', async () => {
      const result = await svc.calculateFee(null, 10000, 'WEBPAY_DEBIT');
      // 10000 * 1.8% = 180 + 50 = 230
      expect(result.totalFee).toBe(230);
      expect(result.netAmount).toBe(9770);
    });

    it('calculates Khipu fee (1.0%)', async () => {
      const result = await svc.calculateFee(null, 10000, 'KHIPU');
      // 10000 * 1.0% = 100, min 50 → 100
      expect(result.totalFee).toBe(100);
      expect(result.netAmount).toBe(9900);
    });

    it('applies minimum fee floor', async () => {
      const result = await svc.calculateFee(null, 1000, 'WEBPAY_CREDIT');
      // 1000 * 2.8% = 28 + 50 = 78, but min is 100
      expect(result.totalFee).toBe(100);
    });

    it('uses merchant override when available', async () => {
      const config: FeeConfig = {
        merchantId: 'm-1',
        rules: [{ method: 'WALLET', percentFee: 1.5, fixedFee: 0, minFee: 0, maxFee: 0 }],
        updatedAt: '2026-01-01',
      };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(config));

      const result = await svc.calculateFee('m-1', 10000, 'WALLET');
      expect(result.totalFee).toBe(150); // 1.5% instead of 0%
    });

    it('falls back to default when merchant has no rule for method', async () => {
      const config: FeeConfig = {
        merchantId: 'm-1',
        rules: [{ method: 'WALLET', percentFee: 1.0, fixedFee: 0, minFee: 0, maxFee: 0 }],
        updatedAt: '2026-01-01',
      };
      mockRedisGet
        .mockResolvedValueOnce(JSON.stringify(config))  // merchant config
        .mockResolvedValueOnce(null);                     // no custom default

      const result = await svc.calculateFee('m-1', 10000, 'KHIPU');
      expect(result.totalFee).toBe(100); // platform default 1%
    });

    it('applies max fee cap', async () => {
      const config: FeeConfig = {
        merchantId: 'm-1',
        rules: [{ method: 'WALLET', percentFee: 5.0, fixedFee: 100, minFee: 0, maxFee: 500 }],
        updatedAt: '2026-01-01',
      };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(config));

      const result = await svc.calculateFee('m-1', 50000, 'WALLET');
      // 50000 * 5% = 2500 + 100 = 2600, capped at 500
      expect(result.totalFee).toBe(500);
    });

    it('rounds fee to nearest integer', async () => {
      const result = await svc.calculateFee(null, 333, 'WEBPAY_CREDIT');
      // 333 * 2.8% = 9.324 → 9 + 50 = 59, but min 100
      expect(Number.isInteger(result.totalFee)).toBe(true);
    });
  });

  // ─── setMerchantFees ───────────────────────────────────

  describe('setMerchantFees', () => {
    const validRules: FeeRule[] = [
      { method: 'WALLET', percentFee: 1.5, fixedFee: 0, minFee: 0, maxFee: 0 },
      { method: 'KHIPU', percentFee: 0.8, fixedFee: 0, minFee: 30, maxFee: 0 },
    ];

    it('saves merchant fee config', async () => {
      const config = await svc.setMerchantFees('m-1', validRules);
      expect(config.merchantId).toBe('m-1');
      expect(config.rules).toHaveLength(2);
      expect(mockRedisSet).toHaveBeenCalledWith(
        'fees:merchant:m-1',
        expect.any(String),
        { EX: 365 * 24 * 60 * 60 },
      );
    });

    it('rejects empty rules', async () => {
      await expect(svc.setMerchantFees('m-1', []))
        .rejects.toThrow('Debe incluir al menos una regla');
    });

    it('rejects invalid payment method', async () => {
      await expect(svc.setMerchantFees('m-1', [
        { method: 'BITCOIN' as never, percentFee: 1, fixedFee: 0, minFee: 0, maxFee: 0 },
      ])).rejects.toThrow('Método de pago inválido');
    });

    it('rejects percent fee > 50%', async () => {
      await expect(svc.setMerchantFees('m-1', [
        { method: 'WALLET', percentFee: 55, fixedFee: 0, minFee: 0, maxFee: 0 },
      ])).rejects.toThrow('Comisión porcentual');
    });

    it('rejects negative percent fee', async () => {
      await expect(svc.setMerchantFees('m-1', [
        { method: 'WALLET', percentFee: -1, fixedFee: 0, minFee: 0, maxFee: 0 },
      ])).rejects.toThrow('Comisión porcentual');
    });

    it('rejects negative fixed fee', async () => {
      await expect(svc.setMerchantFees('m-1', [
        { method: 'WALLET', percentFee: 1, fixedFee: -10, minFee: 0, maxFee: 0 },
      ])).rejects.toThrow('Comisión fija no puede ser negativa');
    });
  });

  // ─── setDefaultFees ────────────────────────────────────

  describe('setDefaultFees', () => {
    it('saves default fee config', async () => {
      const config = await svc.setDefaultFees([
        { method: 'WALLET', percentFee: 0.5, fixedFee: 0, minFee: 0, maxFee: 0 },
      ]);
      expect(config.merchantId).toBeNull();
      expect(mockRedisSet).toHaveBeenCalledWith(
        'fees:default',
        expect.any(String),
        { EX: 365 * 24 * 60 * 60 },
      );
    });
  });

  // ─── getMerchantConfig / getDefaultConfig ──────────────

  describe('getMerchantConfig', () => {
    it('returns config when exists', async () => {
      const config: FeeConfig = {
        merchantId: 'm-1',
        rules: [{ method: 'WALLET', percentFee: 1, fixedFee: 0, minFee: 0, maxFee: 0 }],
        updatedAt: '2026-01-01',
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(config));

      const result = await svc.getMerchantConfig('m-1');
      expect(result).not.toBeNull();
      expect(result!.rules).toHaveLength(1);
    });

    it('returns null when not set', async () => {
      const result = await svc.getMerchantConfig('m-unknown');
      expect(result).toBeNull();
    });

    it('returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const result = await svc.getMerchantConfig('m-1');
      expect(result).toBeNull();
    });
  });

  // ─── removeMerchantFees ────────────────────────────────

  describe('removeMerchantFees', () => {
    it('deletes merchant fee config', async () => {
      const result = await svc.removeMerchantFees('m-1');
      expect(result).toBe(true);
      expect(mockRedisDel).toHaveBeenCalledWith('fees:merchant:m-1');
    });

    it('returns false on Redis error', async () => {
      mockRedisDel.mockRejectedValue(new Error('Redis down'));
      const result = await svc.removeMerchantFees('m-1');
      expect(result).toBe(false);
    });
  });

  // ─── getPlatformDefaults ───────────────────────────────

  describe('getPlatformDefaults', () => {
    it('returns 4 default rules', () => {
      const defaults = svc.getPlatformDefaults();
      expect(defaults).toHaveLength(4);
      expect(defaults.map((r) => r.method)).toEqual(['WALLET', 'WEBPAY_CREDIT', 'WEBPAY_DEBIT', 'KHIPU']);
    });

    it('wallet default is 0% fee', () => {
      const defaults = svc.getPlatformDefaults();
      const wallet = defaults.find((r) => r.method === 'WALLET');
      expect(wallet!.percentFee).toBe(0);
      expect(wallet!.fixedFee).toBe(0);
    });
  });
});
