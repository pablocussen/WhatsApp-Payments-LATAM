const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { PaymentDisputeRefundService } from '../../src/services/payment-dispute-refund.service';

describe('PaymentDisputeRefundService', () => {
  let s: PaymentDisputeRefundService;
  beforeEach(() => { jest.clearAllMocks(); s = new PaymentDisputeRefundService(); mockRedisGet.mockResolvedValue(null); });

  it('creates full refund', async () => {
    const r = await s.requestRefund({ disputeId: 'd1', transactionRef: '#WP-1', userId: 'u1', merchantId: 'm1', originalAmount: 50000, refundAmount: 50000, reason: 'Producto no recibido nunca' });
    expect(r.refundType).toBe('FULL'); expect(r.status).toBe('PENDING');
  });
  it('creates partial refund', async () => {
    const r = await s.requestRefund({ disputeId: 'd1', transactionRef: '#WP-1', userId: 'u1', merchantId: 'm1', originalAmount: 50000, refundAmount: 25000, reason: 'Producto parcialmente danado' });
    expect(r.refundType).toBe('PARTIAL');
  });
  it('rejects over original', async () => { await expect(s.requestRefund({ disputeId: 'd1', transactionRef: '#WP-1', userId: 'u1', merchantId: 'm1', originalAmount: 50000, refundAmount: 60000, reason: 'Quiero mas plata por favor' })).rejects.toThrow('exceder'); });
  it('rejects short reason', async () => { await expect(s.requestRefund({ disputeId: 'd1', transactionRef: '#WP-1', userId: 'u1', merchantId: 'm1', originalAmount: 50000, refundAmount: 50000, reason: 'corto' })).rejects.toThrow('10'); });
  it('approves refund', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'ref_1', status: 'PENDING' }));
    expect(await s.approveRefund('ref_1', 'admin')).toBe(true);
    expect(JSON.parse(mockRedisSet.mock.calls[0][1]).status).toBe('APPROVED');
  });
  it('processes approved refund', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'ref_1', status: 'APPROVED', refundAmount: 50000 }));
    expect(await s.processRefund('ref_1')).toBe(true);
    expect(JSON.parse(mockRedisSet.mock.calls[0][1]).status).toBe('PROCESSED');
  });
  it('rejects pending (not approved) for processing', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'ref_1', status: 'PENDING' }));
    expect(await s.processRefund('ref_1')).toBe(false);
  });
  it('rejects refund', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'ref_1', status: 'PENDING' }));
    expect(await s.rejectRefund('ref_1', 'admin')).toBe(true);
    expect(JSON.parse(mockRedisSet.mock.calls[0][1]).status).toBe('REJECTED');
  });
  it('formats summary', () => { const f = s.formatRefundSummary({ id: 'ref_1', refundType: 'PARTIAL', refundAmount: 25000, originalAmount: 50000, status: 'PENDING' } as any); expect(f).toContain('$25.000'); expect(f).toContain('PARTIAL'); });
});
