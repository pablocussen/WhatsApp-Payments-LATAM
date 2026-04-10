/**
 * MerchantPayoutService — automated merchant disbursements.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisLPush = jest.fn().mockResolvedValue(1);
const mockRedisLRange = jest.fn().mockResolvedValue([]);

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    lPush: (...args: unknown[]) => mockRedisLPush(...args),
    lRange: (...args: unknown[]) => mockRedisLRange(...args),
    multi: jest.fn().mockReturnValue({
      set: jest.fn().mockReturnThis(),
      lPush: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([null, null, null]),
    }),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { MerchantPayoutService } from '../../src/services/merchant-payout.service';

describe('MerchantPayoutService', () => {
  let service: MerchantPayoutService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MerchantPayoutService();
    mockRedisGet.mockResolvedValue(null);
  });

  // ── setConfig ─────────────────────────────────────

  it('saves payout config', async () => {
    const config = await service.setConfig({
      merchantId: 'm1',
      frequency: 'WEEKLY',
      bankName: 'BancoEstado',
      accountType: 'VISTA',
      accountNumber: '123456789',
      rut: '12345678-9',
      holderName: 'Test Merchant',
      minAmount: 5000,
      enabled: true,
    });
    expect(config.merchantId).toBe('m1');
    expect(config.frequency).toBe('WEEKLY');
    expect(config.updatedAt).toBeDefined();
    expect(mockRedisSet).toHaveBeenCalled();
  });

  it('rejects config without bank data', async () => {
    await expect(service.setConfig({
      merchantId: 'm1', frequency: 'DAILY',
      bankName: '', accountType: 'VISTA', accountNumber: '', rut: '', holderName: '',
      minAmount: 5000, enabled: true,
    })).rejects.toThrow('bancarios');
  });

  it('rejects minAmount below 1000', async () => {
    await expect(service.setConfig({
      merchantId: 'm1', frequency: 'DAILY',
      bankName: 'BCI', accountType: 'CORRIENTE', accountNumber: '111',
      rut: '11111111-1', holderName: 'Test', minAmount: 500, enabled: true,
    })).rejects.toThrow('1.000');
  });

  // ── getConfig ─────────────────────────────────────

  it('returns null for unconfigured merchant', async () => {
    expect(await service.getConfig('unknown')).toBeNull();
  });

  it('returns stored config', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ merchantId: 'm1', frequency: 'WEEKLY' }));
    const config = await service.getConfig('m1');
    expect(config?.frequency).toBe('WEEKLY');
  });

  // ── createPayout ──────────────────────────────────

  it('creates a payout with zero fee', async () => {
    const payout = await service.createPayout({
      merchantId: 'm1', amount: 50000, transactionCount: 12,
      periodStart: '2026-04-01', periodEnd: '2026-04-07',
    });
    expect(payout.id).toMatch(/^po_/);
    expect(payout.amount).toBe(50000);
    expect(payout.fee).toBe(0);
    expect(payout.netAmount).toBe(50000);
    expect(payout.status).toBe('PENDING');
    expect(payout.transactionCount).toBe(12);
  });

  it('rejects payout below 1000', async () => {
    await expect(service.createPayout({
      merchantId: 'm1', amount: 500, transactionCount: 1,
      periodStart: '2026-04-01', periodEnd: '2026-04-07',
    })).rejects.toThrow('1.000');
  });

  // ── getPayout ─────────────────────────────────────

  it('returns null for non-existent payout', async () => {
    expect(await service.getPayout('po_nonexistent')).toBeNull();
  });

  it('returns stored payout', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'po_1', status: 'PENDING' }));
    const payout = await service.getPayout('po_1');
    expect(payout?.status).toBe('PENDING');
  });

  // ── getMerchantPayouts ────────────────────────────

  it('returns empty list for new merchant', async () => {
    const payouts = await service.getMerchantPayouts('m1');
    expect(payouts).toEqual([]);
  });

  it('returns payouts from list', async () => {
    mockRedisLRange.mockResolvedValue(['po_1', 'po_2']);
    mockRedisGet
      .mockResolvedValueOnce(JSON.stringify({ id: 'po_1', amount: 10000 }))
      .mockResolvedValueOnce(JSON.stringify({ id: 'po_2', amount: 20000 }));
    const payouts = await service.getMerchantPayouts('m1');
    expect(payouts).toHaveLength(2);
    expect(payouts[0].amount).toBe(10000);
  });

  // ── markCompleted ─────────────────────────────────

  it('marks payout as completed with bank ref', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      id: 'po_1', merchantId: 'm1', amount: 50000, netAmount: 50000, status: 'PROCESSING',
    }));
    const result = await service.markCompleted('po_1', 'TEF-123456');
    expect(result).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.status).toBe('COMPLETED');
    expect(saved.bankRef).toBe('TEF-123456');
    expect(saved.processedAt).toBeDefined();
  });

  it('returns false for non-existent payout', async () => {
    expect(await service.markCompleted('po_nonexistent', 'REF')).toBe(false);
  });

  // ── markFailed ────────────────────────────────────

  it('marks payout as failed with reason', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      id: 'po_1', merchantId: 'm1', status: 'PROCESSING',
    }));
    const result = await service.markFailed('po_1', 'Cuenta no existe');
    expect(result).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.status).toBe('FAILED');
    expect(saved.failureReason).toBe('Cuenta no existe');
  });

  // ── markProcessing ────────────────────────────────

  it('marks payout as processing', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      id: 'po_1', status: 'PENDING',
    }));
    const result = await service.markProcessing('po_1');
    expect(result).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.status).toBe('PROCESSING');
  });

  // ── getPayoutSummary ──────────────────────────────

  it('formats payout summary', () => {
    const summary = service.getPayoutSummary({
      id: 'po_1', merchantId: 'm1', amount: 50000, fee: 0, netAmount: 50000,
      transactionCount: 12, periodStart: '2026-04-01', periodEnd: '2026-04-07',
      status: 'COMPLETED', bankRef: 'TEF-123', createdAt: '', processedAt: '', failureReason: null,
    });
    expect(summary).toContain('$50.000');
    expect(summary).toContain('12 transacciones');
    expect(summary).toContain('COMPLETED');
    expect(summary).toContain('TEF-123');
  });

  it('formats summary without bank ref', () => {
    const summary = service.getPayoutSummary({
      id: 'po_1', merchantId: 'm1', amount: 10000, fee: 0, netAmount: 10000,
      transactionCount: 3, periodStart: '2026-04-01', periodEnd: '2026-04-07',
      status: 'PENDING', bankRef: null, createdAt: '', processedAt: null, failureReason: null,
    });
    expect(summary).not.toContain('Ref:');
    expect(summary).toContain('PENDING');
  });
});
