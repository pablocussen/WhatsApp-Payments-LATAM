/**
 * BatchPaymentService — process multiple payments at once.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockProcessP2PPayment = jest.fn();

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    sAdd: jest.fn(), sMembers: jest.fn().mockResolvedValue([]),
    lPush: jest.fn(), lRange: jest.fn().mockResolvedValue([]),
    expire: jest.fn().mockResolvedValue(true),
    zAdd: jest.fn(), zCard: jest.fn().mockResolvedValue(0),
    multi: jest.fn().mockReturnValue({
      incr: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([0, 0, 0]),
    }),
  }),
  prisma: {
    $transaction: jest.fn(),
    user: { findUnique: jest.fn() },
    transaction: { create: jest.fn(), update: jest.fn(), findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0), aggregate: jest.fn().mockResolvedValue({ _sum: { amount: 0 } }) },
    wallet: { findUnique: jest.fn(), update: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test' },
}));

jest.mock('../../src/services/transaction.service', () => ({
  TransactionService: jest.fn().mockImplementation(() => ({
    processP2PPayment: mockProcessP2PPayment,
  })),
}));

import { BatchPaymentService } from '../../src/services/batch-payment.service';

describe('BatchPaymentService', () => {
  let service: BatchPaymentService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BatchPaymentService();
    mockRedisGet.mockResolvedValue(null);
    mockProcessP2PPayment.mockResolvedValue({
      success: true,
      reference: '#WP-2026-BATCH01',
      fee: 0,
      senderBalance: '$50.000 CLP',
    });
  });

  // ── Validation ─────────────────────────────────────

  it('rejects empty items', async () => {
    await expect(service.processBatch({
      senderId: 'user-1', senderWaId: '56912345678', items: [],
    })).rejects.toThrow('al menos un pago');
  });

  it('rejects more than 50 items', async () => {
    const items = Array.from({ length: 51 }, (_, i) => ({
      receiverId: `user-${i}`, receiverName: `User ${i}`, amount: 1000,
    }));
    await expect(service.processBatch({
      senderId: 'user-1', senderWaId: '56912345678', items,
    })).rejects.toThrow('50');
  });

  it('rejects amount below minimum', async () => {
    await expect(service.processBatch({
      senderId: 'user-1', senderWaId: '56912345678',
      items: [{ receiverId: 'user-2', receiverName: 'Test', amount: 50 }],
    })).rejects.toThrow('Monto');
  });

  it('rejects self-payment', async () => {
    await expect(service.processBatch({
      senderId: 'user-1', senderWaId: '56912345678',
      items: [{ receiverId: 'user-1', receiverName: 'Self', amount: 1000 }],
    })).rejects.toThrow('ti mismo');
  });

  // ── Successful batch ───────────────────────────────

  it('processes all payments successfully', async () => {
    const batch = await service.processBatch({
      senderId: 'user-1',
      senderWaId: '56912345678',
      items: [
        { receiverId: 'user-2', receiverName: 'Juan', amount: 5000 },
        { receiverId: 'user-3', receiverName: 'María', amount: 3000 },
      ],
    });

    expect(batch.status).toBe('completed');
    expect(batch.successCount).toBe(2);
    expect(batch.failCount).toBe(0);
    expect(batch.totalAmount).toBe(8000);
    expect(batch.results).toHaveLength(2);
    expect(batch.results[0].status).toBe('success');
    expect(batch.id).toMatch(/^bat_/);
    expect(batch.completedAt).toBeTruthy();
  });

  it('stores batch in Redis', async () => {
    await service.processBatch({
      senderId: 'user-1', senderWaId: '56912345678',
      items: [{ receiverId: 'user-2', receiverName: 'Juan', amount: 5000 }],
    });

    expect(mockRedisSet).toHaveBeenCalledWith(
      expect.stringMatching(/^batch:bat_/),
      expect.any(String),
      { EX: 30 * 24 * 60 * 60 },
    );
  });

  // ── Partial failure ────────────────────────────────

  it('handles partial failures', async () => {
    mockProcessP2PPayment
      .mockResolvedValueOnce({ success: true, reference: '#WP-OK', fee: 0 })
      .mockResolvedValueOnce({ success: false, error: 'Saldo insuficiente' });

    const batch = await service.processBatch({
      senderId: 'user-1', senderWaId: '56912345678',
      items: [
        { receiverId: 'user-2', receiverName: 'Juan', amount: 5000 },
        { receiverId: 'user-3', receiverName: 'María', amount: 100000 },
      ],
    });

    expect(batch.status).toBe('partial');
    expect(batch.successCount).toBe(1);
    expect(batch.failCount).toBe(1);
    expect(batch.results[0].status).toBe('success');
    expect(batch.results[1].status).toBe('failed');
    expect(batch.results[1].error).toContain('Saldo insuficiente');
  });

  // ── All failures ───────────────────────────────────

  it('handles all failures', async () => {
    mockProcessP2PPayment.mockResolvedValue({ success: false, error: 'Error' });

    const batch = await service.processBatch({
      senderId: 'user-1', senderWaId: '56912345678',
      items: [
        { receiverId: 'user-2', receiverName: 'Juan', amount: 5000 },
        { receiverId: 'user-3', receiverName: 'María', amount: 3000 },
      ],
    });

    expect(batch.status).toBe('failed');
    expect(batch.successCount).toBe(0);
    expect(batch.failCount).toBe(2);
  });

  // ── Exception handling ─────────────────────────────

  it('handles transaction service throwing', async () => {
    mockProcessP2PPayment.mockRejectedValue(new Error('DB timeout'));

    const batch = await service.processBatch({
      senderId: 'user-1', senderWaId: '56912345678',
      items: [{ receiverId: 'user-2', receiverName: 'Juan', amount: 5000 }],
    });

    expect(batch.status).toBe('failed');
    expect(batch.failCount).toBe(1);
    expect(batch.results[0].error).toContain('DB timeout');
  });

  // ── getBatch ───────────────────────────────────────

  it('retrieves a stored batch', async () => {
    const stored = { id: 'bat_test', status: 'completed', items: [] };
    mockRedisGet.mockResolvedValue(JSON.stringify(stored));

    const result = await service.getBatch('bat_test');
    expect(result).toEqual(stored);
    expect(mockRedisGet).toHaveBeenCalledWith('batch:bat_test');
  });

  it('returns null for non-existent batch', async () => {
    mockRedisGet.mockResolvedValue(null);
    const result = await service.getBatch('bat_nonexistent');
    expect(result).toBeNull();
  });

  // ── Fee tracking ───────────────────────────────────

  it('accumulates fees across items', async () => {
    mockProcessP2PPayment.mockResolvedValue({
      success: true, reference: '#WP-FEE', fee: 150, senderBalance: '$40.000',
    });

    const batch = await service.processBatch({
      senderId: 'user-1', senderWaId: '56912345678',
      items: [
        { receiverId: 'user-2', receiverName: 'A', amount: 5000 },
        { receiverId: 'user-3', receiverName: 'B', amount: 3000 },
      ],
    });

    expect(batch.totalFees).toBe(300); // 150 * 2
  });
});
