const mockRedisLPush = jest.fn().mockResolvedValue(1);
const mockRedisLRange = jest.fn().mockResolvedValue([]);
const mockRedisExpire = jest.fn().mockResolvedValue(true);
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ lPush: (...a: unknown[]) => mockRedisLPush(...a), lRange: (...a: unknown[]) => mockRedisLRange(...a), expire: (...a: unknown[]) => mockRedisExpire(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantTaxRecordService } from '../../src/services/merchant-tax-record.service';

describe('MerchantTaxRecordService', () => {
  let s: MerchantTaxRecordService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantTaxRecordService(); mockRedisLRange.mockResolvedValue([]); });

  it('records transaction', async () => {
    const r = await s.recordTransaction({ merchantId: 'm1', transactionRef: '#WP-1', subtotal: 100000, ivaAmount: 19000, total: 119000, isExempt: false, category: null, documentType: 'BOLETA', documentNumber: null });
    expect(r.id).toMatch(/^txrec_/);
    expect(mockRedisLPush).toHaveBeenCalled();
  });
  it('returns empty for no records', async () => { expect(await s.getMonthlyRecords('m1', '2026-04')).toEqual([]); });
  it('parses records', async () => {
    mockRedisLRange.mockResolvedValue([
      JSON.stringify({ id: 'r1', subtotal: 100000, ivaAmount: 19000, isExempt: false }),
      JSON.stringify({ id: 'r2', subtotal: 50000, ivaAmount: 9500, isExempt: false }),
    ]);
    const records = await s.getMonthlyRecords('m1', '2026-04');
    expect(records).toHaveLength(2);
  });
  it('calculates monthly summary', async () => {
    mockRedisLRange.mockResolvedValue([
      JSON.stringify({ subtotal: 100000, ivaAmount: 19000, isExempt: false }),
      JSON.stringify({ subtotal: 50000, ivaAmount: 9500, isExempt: false }),
      JSON.stringify({ subtotal: 30000, ivaAmount: 0, isExempt: true }),
    ]);
    const sum = await s.getMonthlySummary('m1', '2026-04');
    expect(sum.totalTransactions).toBe(3);
    expect(sum.totalSubtotal).toBe(180000);
    expect(sum.totalIVA).toBe(28500);
    expect(sum.totalExempt).toBe(30000);
    expect(sum.netToDeclare).toBe(28500);
  });
  it('returns empty summary', async () => {
    const sum = await s.getMonthlySummary('m1', '2026-04');
    expect(sum.totalTransactions).toBe(0);
    expect(sum.totalIVA).toBe(0);
  });
  it('formats summary', () => {
    const f = s.formatSummary({ period: '2026-04', totalTransactions: 50, totalSubtotal: 1000000, totalIVA: 190000, totalExempt: 100000, netToDeclare: 190000 });
    expect(f).toContain('2026-04');
    expect(f).toContain('50');
    expect(f).toContain('$190.000');
  });
});
