const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { PaymentLinkAnalyticsService } from '../../src/services/payment-link-analytics.service';

describe('PaymentLinkAnalyticsService', () => {
  let s: PaymentLinkAnalyticsService;
  beforeEach(() => { jest.clearAllMocks(); s = new PaymentLinkAnalyticsService(); mockRedisGet.mockResolvedValue(null); });

  it('records view', async () => { await s.recordView('l1', 'm1', 'v1'); const saved = JSON.parse(mockRedisSet.mock.calls[0][1]); expect(saved.views).toBe(1); expect(saved.uniqueVisitors).toBe(1); });
  it('records payment', async () => { await s.recordPayment('l1', 'm1', 5000); const saved = JSON.parse(mockRedisSet.mock.calls[0][1]); expect(saved.payments).toBe(1); expect(saved.totalCollected).toBe(5000); });
  it('calculates conversion', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ linkId: 'l1', views: 10, payments: 2, totalCollected: 10000, uniqueVisitors: 8, conversionRate: 20, topReferrers: [], avgPaymentTime: 0 }));
    await s.recordPayment('l1', 'm1', 5000);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.payments).toBe(3);
    expect(saved.conversionRate).toBe(30);
  });
  it('returns empty for new link', async () => { const a = await s.getAnalytics('l1', 'm1'); expect(a.views).toBe(0); expect(a.payments).toBe(0); });
  it('formats summary', () => { const f = s.formatSummary({ linkId: 'l1', views: 100, payments: 15, conversionRate: 15, totalCollected: 75000 } as any); expect(f).toContain('100 vistas'); expect(f).toContain('15 pagos'); expect(f).toContain('15%'); expect(f).toContain('$75.000'); });
});
