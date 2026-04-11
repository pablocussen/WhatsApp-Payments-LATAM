/**
 * ApiUsageAnalyticsService — analytics de uso de API por merchant.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { ApiUsageAnalyticsService } from '../../src/services/api-usage-analytics.service';

describe('ApiUsageAnalyticsService', () => {
  let service: ApiUsageAnalyticsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ApiUsageAnalyticsService();
    mockRedisGet.mockResolvedValue(null);
  });

  it('records first request', async () => {
    await service.recordRequest('m1', '/api/v1/payments', 'POST', 120, false, false);
    expect(mockRedisSet).toHaveBeenCalled();
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.totalRequests).toBe(1);
    expect(saved.totalErrors).toBe(0);
    expect(saved.endpoints).toHaveLength(1);
    expect(saved.endpoints[0].avgResponseMs).toBe(120);
  });

  it('records error request', async () => {
    await service.recordRequest('m1', '/api/v1/payments', 'POST', 50, true, false);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.totalErrors).toBe(1);
    expect(saved.errorRate).toBe(100);
  });

  it('records rate limited request', async () => {
    await service.recordRequest('m1', '/api/v1/payments', 'POST', 10, false, true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.rateLimitHits).toBe(1);
  });

  it('accumulates to existing summary', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      merchantId: 'm1', period: '2026-04-11', totalRequests: 10, totalErrors: 1,
      errorRate: 10, endpoints: [{ endpoint: '/api/v1/payments', method: 'POST', requestCount: 10, errorCount: 1, avgResponseMs: 100, totalResponseMs: 1000, rateLimitHits: 0 }],
      rateLimitHits: 0, updatedAt: '',
    }));
    await service.recordRequest('m1', '/api/v1/payments', 'POST', 200, false, false);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.totalRequests).toBe(11);
    expect(saved.endpoints[0].requestCount).toBe(11);
    expect(saved.endpoints[0].avgResponseMs).toBe(109); // (1000+200)/11
  });

  it('returns null for no data', async () => {
    expect(await service.getDailySummary('m1')).toBeNull();
  });

  it('returns stored summary', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ merchantId: 'm1', totalRequests: 50 }));
    const s = await service.getDailySummary('m1');
    expect(s?.totalRequests).toBe(50);
  });

  it('returns top endpoints', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      merchantId: 'm1', endpoints: [
        { endpoint: '/a', requestCount: 10 },
        { endpoint: '/b', requestCount: 50 },
        { endpoint: '/c', requestCount: 30 },
      ],
    }));
    const top = await service.getTopEndpoints('m1', undefined, 2);
    expect(top).toHaveLength(2);
    expect(top[0].endpoint).toBe('/b');
  });

  it('detects high error rate', () => {
    expect(service.hasHighErrorRate({ errorRate: 10 } as any)).toBe(true);
    expect(service.hasHighErrorRate({ errorRate: 3 } as any)).toBe(false);
  });

  it('formats summary', () => {
    const f = service.formatSummary({
      merchantId: 'm1', period: '2026-04-11', totalRequests: 100, totalErrors: 8,
      errorRate: 8, endpoints: [{ endpoint: '/a' } as any, { endpoint: '/b' } as any],
      rateLimitHits: 3, updatedAt: '',
    });
    expect(f).toContain('100');
    expect(f).toContain('8%');
    expect(f).toContain('ALERTA');
    expect(f).toContain('Rate limit hits: 3');
  });

  it('formats summary without alert', () => {
    const f = service.formatSummary({
      merchantId: 'm1', period: '2026-04-11', totalRequests: 100, totalErrors: 2,
      errorRate: 2, endpoints: [], rateLimitHits: 0, updatedAt: '',
    });
    expect(f).not.toContain('ALERTA');
  });
});
