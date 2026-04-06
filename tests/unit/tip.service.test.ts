/**
 * TipService — propina para pagos.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisIncrBy = jest.fn().mockResolvedValue(1);

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    incrBy: (...args: unknown[]) => mockRedisIncrBy(...args),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { TipService } from '../../src/services/tip.service';

describe('TipService', () => {
  let service: TipService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TipService();
    mockRedisGet.mockResolvedValue(null);
  });

  // ── calculateTip ──────────────────────────────────

  describe('calculateTip', () => {
    it('calculates 10% tip correctly', () => {
      const result = service.calculateTip(10000, 10);
      expect(result.tipAmount).toBe(1000);
      expect(result.totalAmount).toBe(11000);
      expect(result.tipFormatted).toBe('$1.000');
      expect(result.totalFormatted).toBe('$11.000');
    });

    it('calculates 15% tip correctly', () => {
      const result = service.calculateTip(20000, 15);
      expect(result.tipAmount).toBe(3000);
      expect(result.totalAmount).toBe(23000);
    });

    it('rounds tip to nearest integer', () => {
      const result = service.calculateTip(3333, 10);
      expect(result.tipAmount).toBe(333);
      expect(result.totalAmount).toBe(3666);
    });

    it('handles 0% tip', () => {
      const result = service.calculateTip(5000, 0);
      expect(result.tipAmount).toBe(0);
      expect(result.totalAmount).toBe(5000);
    });

    it('rejects negative tip', () => {
      expect(() => service.calculateTip(5000, -5)).toThrow('entre 0%');
    });

    it('rejects tip over 50%', () => {
      expect(() => service.calculateTip(5000, 55)).toThrow('50%');
    });

    it('rejects non-positive amount', () => {
      expect(() => service.calculateTip(0, 10)).toThrow('positivo');
    });
  });

  // ── getSuggestions ────────────────────────────────

  describe('getSuggestions', () => {
    it('returns 4 suggestions (5%, 10%, 15%, 20%)', () => {
      const suggestions = service.getSuggestions(10000);
      expect(suggestions).toHaveLength(4);
      expect(suggestions.map(s => s.percent)).toEqual([5, 10, 15, 20]);
    });

    it('calculates correct totals', () => {
      const suggestions = service.getSuggestions(10000);
      expect(suggestions[0].total).toBe(10500); // 5%
      expect(suggestions[1].total).toBe(11000); // 10%
      expect(suggestions[2].total).toBe(11500); // 15%
      expect(suggestions[3].total).toBe(12000); // 20%
    });

    it('formats totals correctly', () => {
      const suggestions = service.getSuggestions(10000);
      expect(suggestions[1].totalFormatted).toBe('$11.000');
    });
  });

  // ── recordTip ─────────────────────────────────────

  describe('recordTip', () => {
    it('stores tip record in Redis', async () => {
      const record = await service.recordTip({
        transactionRef: '#WP-TIP-001',
        senderId: 'user-1',
        receiverId: 'merchant-1',
        baseAmount: 10000,
        tipPercent: 10,
      });

      expect(record.tipAmount).toBe(1000);
      expect(record.id).toMatch(/^tip_/);
      expect(mockRedisSet).toHaveBeenCalled();
    });

    it('increments receiver total tips', async () => {
      await service.recordTip({
        transactionRef: '#WP-TIP-002',
        senderId: 'user-1',
        receiverId: 'merchant-1',
        baseAmount: 20000,
        tipPercent: 15,
      });

      expect(mockRedisIncrBy).toHaveBeenCalledWith('tips:total:merchant-1', 3000);
    });
  });

  // ── getTotalTipsReceived ──────────────────────────

  describe('getTotalTipsReceived', () => {
    it('returns total from Redis', async () => {
      mockRedisGet.mockResolvedValue('25000');
      const total = await service.getTotalTipsReceived('merchant-1');
      expect(total).toBe(25000);
    });

    it('returns 0 when no tips', async () => {
      mockRedisGet.mockResolvedValue(null);
      const total = await service.getTotalTipsReceived('merchant-1');
      expect(total).toBe(0);
    });
  });
});
