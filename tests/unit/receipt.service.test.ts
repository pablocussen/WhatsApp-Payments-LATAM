/**
 * Unit tests for ReceiptService.
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

import { ReceiptService } from '../../src/services/receipt.service';
import type { Receipt } from '../../src/services/receipt.service';

describe('ReceiptService', () => {
  let svc: ReceiptService;

  beforeEach(() => {
    svc = new ReceiptService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
  });

  const validInput = {
    type: 'payment' as const,
    reference: '#WP-ABC123',
    senderName: 'Juan',
    senderPhone: '+56911111111',
    receiverName: 'María',
    receiverPhone: '+56922222222',
    amount: 10000,
    fee: 150,
    paymentMethod: 'WALLET',
    status: 'COMPLETED',
  };

  // ─── generate ──────────────────────────────────────────

  describe('generate', () => {
    it('creates receipt with rcp_ prefix', async () => {
      const receipt = await svc.generate(validInput);
      expect(receipt.id).toMatch(/^rcp_[0-9a-f]{16}$/);
      expect(receipt.type).toBe('payment');
      expect(receipt.reference).toBe('#WP-ABC123');
      expect(receipt.amount).toBe(10000);
      expect(receipt.fee).toBe(150);
      expect(receipt.netAmount).toBe(9850);
    });

    it('generates formatted text with all fields', async () => {
      const receipt = await svc.generate({ ...validInput, description: 'Almuerzo' });
      expect(receipt.formattedText).toContain('Comprobante de Pago');
      expect(receipt.formattedText).toContain('#WP-ABC123');
      expect(receipt.formattedText).toContain('Juan');
      expect(receipt.formattedText).toContain('María');
      expect(receipt.formattedText).toContain('Almuerzo');
      expect(receipt.formattedText).toContain('WhatPay Chile');
    });

    it('omits fee line when fee is 0', async () => {
      const receipt = await svc.generate({ ...validInput, fee: 0 });
      expect(receipt.formattedText).not.toContain('Comisión');
      expect(receipt.netAmount).toBe(10000);
    });

    it('stores receipt in Redis with TTL', async () => {
      await svc.generate(validInput);
      expect(mockRedisSet).toHaveBeenCalledWith(
        expect.stringMatching(/^receipt:rcp_/),
        expect.any(String),
        { EX: 90 * 24 * 60 * 60 },
      );
    });

    it('indexes by both sender and receiver phone', async () => {
      await svc.generate(validInput);
      // Should have calls for: receipt storage + sender index + receiver index
      const indexCalls = mockRedisSet.mock.calls.filter(
        (c: unknown[]) => (c[0] as string).startsWith('receipt:user:'),
      );
      expect(indexCalls.length).toBeGreaterThanOrEqual(2);
    });

    it('uses custom createdAt when provided', async () => {
      const receipt = await svc.generate({ ...validInput, createdAt: '2026-01-15T10:00:00Z' });
      expect(receipt.createdAt).toBe('2026-01-15T10:00:00Z');
    });

    it('formats topup receipt', async () => {
      const receipt = await svc.generate({ ...validInput, type: 'topup' });
      expect(receipt.formattedText).toContain('Comprobante de Recarga');
    });

    it('formats refund receipt', async () => {
      const receipt = await svc.generate({ ...validInput, type: 'refund' });
      expect(receipt.formattedText).toContain('Comprobante de Devolución');
    });

    it('formats subscription receipt', async () => {
      const receipt = await svc.generate({ ...validInput, type: 'subscription' });
      expect(receipt.formattedText).toContain('Comprobante de Suscripción');
    });

    it('does not throw on Redis error', async () => {
      mockRedisSet.mockRejectedValue(new Error('Redis down'));
      const receipt = await svc.generate(validInput);
      expect(receipt.id).toBeDefined();
    });
  });

  // ─── getReceipt ────────────────────────────────────────

  describe('getReceipt', () => {
    it('returns receipt by ID', async () => {
      const stored: Receipt = {
        id: 'rcp_abc', type: 'payment', reference: '#WP-X',
        senderName: 'A', senderPhone: '+569', receiverName: 'B', receiverPhone: '+568',
        amount: 5000, fee: 0, netAmount: 5000, description: null,
        paymentMethod: 'WALLET', status: 'COMPLETED',
        createdAt: '2026-01-01', formattedText: 'test',
      };
      mockRedisGet.mockResolvedValue(JSON.stringify(stored));

      const receipt = await svc.getReceipt('rcp_abc');
      expect(receipt).not.toBeNull();
      expect(receipt!.reference).toBe('#WP-X');
    });

    it('returns null for unknown ID', async () => {
      const receipt = await svc.getReceipt('rcp_unknown');
      expect(receipt).toBeNull();
    });

    it('returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const receipt = await svc.getReceipt('rcp_abc');
      expect(receipt).toBeNull();
    });
  });

  // ─── getUserReceipts ───────────────────────────────────

  describe('getUserReceipts', () => {
    it('returns receipts for a phone', async () => {
      const receipt: Receipt = {
        id: 'rcp_1', type: 'payment', reference: '#WP-1',
        senderName: 'A', senderPhone: '+56911111111', receiverName: 'B', receiverPhone: '+56922222222',
        amount: 5000, fee: 0, netAmount: 5000, description: null,
        paymentMethod: 'WALLET', status: 'COMPLETED',
        createdAt: '2026-01-01', formattedText: 'test',
      };

      mockRedisGet
        .mockResolvedValueOnce(JSON.stringify(['rcp_1'])) // index
        .mockResolvedValueOnce(JSON.stringify(receipt));    // receipt

      const results = await svc.getUserReceipts('+56911111111');
      expect(results).toHaveLength(1);
    });

    it('returns empty when no receipts', async () => {
      const results = await svc.getUserReceipts('+56911111111');
      expect(results).toEqual([]);
    });

    it('returns empty on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const results = await svc.getUserReceipts('+56911111111');
      expect(results).toEqual([]);
    });
  });

  // ─── findByReference ───────────────────────────────────

  describe('findByReference', () => {
    it('finds receipt by transaction reference', async () => {
      const receipt: Receipt = {
        id: 'rcp_1', type: 'payment', reference: '#WP-FIND',
        senderName: 'A', senderPhone: '+56911111111', receiverName: 'B', receiverPhone: '+56922222222',
        amount: 5000, fee: 0, netAmount: 5000, description: null,
        paymentMethod: 'WALLET', status: 'COMPLETED',
        createdAt: '2026-01-01', formattedText: 'test',
      };

      mockRedisGet
        .mockResolvedValueOnce(JSON.stringify(['rcp_1']))
        .mockResolvedValueOnce(JSON.stringify(receipt));

      const result = await svc.findByReference('+56911111111', '#WP-FIND');
      expect(result).not.toBeNull();
      expect(result!.reference).toBe('#WP-FIND');
    });

    it('returns null when no match', async () => {
      mockRedisGet.mockResolvedValueOnce(JSON.stringify([]));
      const result = await svc.findByReference('+56911111111', '#WP-NOPE');
      expect(result).toBeNull();
    });
  });
});
