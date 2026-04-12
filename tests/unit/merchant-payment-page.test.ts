const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantPaymentPageService } from '../../src/services/merchant-payment-page.service';

describe('MerchantPaymentPageService', () => {
  let s: MerchantPaymentPageService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantPaymentPageService(); mockRedisGet.mockResolvedValue(null); });

  it('creates page', async () => { const p = await s.createPage({ merchantId: 'm1', slug: 'cafe-central', title: 'Cafe Central', description: 'Paga tu cafe' }); expect(p.slug).toBe('cafe-central'); expect(p.amounts).toEqual([5000, 10000, 20000, 50000]); expect(p.active).toBe(true); });
  it('rejects invalid slug', async () => { await expect(s.createPage({ merchantId: 'm1', slug: 'Cafe Central!', title: 'X', description: 'X' })).rejects.toThrow('alfanumerico'); });
  it('rejects long slug', async () => { await expect(s.createPage({ merchantId: 'm1', slug: 'x'.repeat(31), title: 'X', description: 'X' })).rejects.toThrow('30'); });
  it('returns null for missing', async () => { expect(await s.getPage('nope')).toBeNull(); });
  it('records payment', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ slug: 'cafe', active: true, minAmount: 100, maxAmount: 2000000, totalCollected: 50000, totalPayments: 5 }));
    expect(await s.recordPayment('cafe', 10000)).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.totalCollected).toBe(60000); expect(saved.totalPayments).toBe(6);
  });
  it('rejects payment on inactive', async () => { mockRedisGet.mockResolvedValue(JSON.stringify({ active: false })); expect(await s.recordPayment('x', 5000)).toBe(false); });
  it('rejects below min', async () => { mockRedisGet.mockResolvedValue(JSON.stringify({ active: true, minAmount: 1000, maxAmount: 2000000 })); expect(await s.recordPayment('x', 500)).toBe(false); });
  it('generates URL', () => { expect(s.getPageUrl('cafe-central')).toBe('https://whatpay.cl/pay/cafe-central'); });
  it('formats summary', () => { const f = s.formatPageSummary({ title: 'Cafe', slug: 'cafe', totalPayments: 50, totalCollected: 500000 } as any); expect(f).toContain('Cafe'); expect(f).toContain('$500.000'); });
});
