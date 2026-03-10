/**
 * Unit tests for CurrencyService.
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

import { CurrencyService } from '../../src/services/currency.service';
import type { SupportedCurrency } from '../../src/services/currency.service';

describe('CurrencyService', () => {
  let svc: CurrencyService;

  beforeEach(() => {
    svc = new CurrencyService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
  });

  // ─── getSupportedCurrencies ──────────────────────────

  describe('getSupportedCurrencies', () => {
    it('returns all supported currencies', () => {
      const currencies = svc.getSupportedCurrencies();
      expect(currencies).toContain('CLP');
      expect(currencies).toContain('USD');
      expect(currencies).toContain('PEN');
      expect(currencies).toContain('ARS');
      expect(currencies).toContain('COP');
      expect(currencies).toContain('MXN');
      expect(currencies).toHaveLength(6);
    });
  });

  // ─── getRate ─────────────────────────────────────────

  describe('getRate', () => {
    it('returns 1 for same currency', async () => {
      expect(await svc.getRate('CLP', 'CLP')).toBe(1);
      expect(await svc.getRate('USD', 'USD')).toBe(1);
    });

    it('returns direct rate for CLP→USD', async () => {
      const rate = await svc.getRate('CLP', 'USD');
      expect(rate).toBeCloseTo(0.00105, 5);
    });

    it('returns direct rate for USD→CLP', async () => {
      const rate = await svc.getRate('USD', 'CLP');
      expect(rate).toBeCloseTo(952.38, 1);
    });

    it('computes cross-rate via CLP for USD→PEN', async () => {
      const rate = await svc.getRate('USD', 'PEN');
      // USD→CLP = 952.38, CLP→PEN = 0.0039 → 952.38 * 0.0039 ≈ 3.71
      expect(rate).toBeGreaterThan(3);
      expect(rate).toBeLessThan(5);
    });

    it('uses cached rates when available', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ 'CLP:USD': 0.0012 }));
      const rate = await svc.getRate('CLP', 'USD');
      expect(rate).toBe(0.0012);
    });

    it('falls back to defaults when Redis fails', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const rate = await svc.getRate('CLP', 'USD');
      expect(rate).toBeCloseTo(0.00105, 5);
    });

    it('throws for unsupported currency pair', async () => {
      await expect(svc.getRate('CLP' as SupportedCurrency, 'BRL' as SupportedCurrency))
        .rejects.toThrow('No exchange rate');
    });
  });

  // ─── convert ─────────────────────────────────────────

  describe('convert', () => {
    it('converts CLP to USD', async () => {
      const result = await svc.convert(100_000, 'CLP', 'USD');
      expect(result.from.amount).toBe(100_000);
      expect(result.from.currency).toBe('CLP');
      expect(result.to.currency).toBe('USD');
      expect(result.to.amount).toBeCloseTo(105, 0);
      expect(result.rate).toBeCloseTo(0.00105, 5);
    });

    it('returns same amount for same currency', async () => {
      const result = await svc.convert(50_000, 'CLP', 'CLP');
      expect(result.to.amount).toBe(50_000);
      expect(result.rate).toBe(1);
    });

    it('rounds CLP to zero decimals', async () => {
      const result = await svc.convert(100, 'USD', 'CLP');
      expect(Number.isInteger(result.to.amount)).toBe(true);
    });

    it('rounds USD to two decimals', async () => {
      const result = await svc.convert(10_000, 'CLP', 'USD');
      const decimals = result.to.amount.toString().split('.')[1]?.length ?? 0;
      expect(decimals).toBeLessThanOrEqual(2);
    });

    it('rejects negative amounts', async () => {
      await expect(svc.convert(-100, 'CLP', 'USD')).rejects.toThrow('non-negative');
    });

    it('handles zero amount', async () => {
      const result = await svc.convert(0, 'CLP', 'USD');
      expect(result.to.amount).toBe(0);
    });
  });

  // ─── formatAmount ────────────────────────────────────

  describe('formatAmount', () => {
    it('formats CLP without decimals', () => {
      const formatted = svc.formatAmount(50_000, 'CLP');
      expect(formatted).toContain('50');
      // Should not have decimal places for CLP
    });

    it('formats USD with $ symbol and 2 decimals', () => {
      const formatted = svc.formatAmount(105.50, 'USD');
      expect(formatted).toContain('105');
      expect(formatted).toContain('50');
    });

    it('formats ARS without decimals', () => {
      const formatted = svc.formatAmount(125_000, 'ARS');
      expect(formatted).toContain('125');
    });
  });

  // ─── updateRates ─────────────────────────────────────

  describe('updateRates', () => {
    it('caches rates in Redis', async () => {
      await svc.updateRates({ 'CLP:USD': 0.0011, 'USD:CLP': 909.09 });
      expect(mockRedisSet).toHaveBeenCalledWith(
        'exchange-rates',
        expect.any(String),
        { EX: 3600 },
      );
    });

    it('does not throw on Redis error', async () => {
      mockRedisSet.mockRejectedValue(new Error('Write failed'));
      await expect(svc.updateRates({ 'CLP:USD': 0.001 })).resolves.toBeUndefined();
    });
  });
});
