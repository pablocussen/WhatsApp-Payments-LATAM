const mockRedisLPush = jest.fn().mockResolvedValue(1);
const mockRedisLTrim = jest.fn().mockResolvedValue('OK');
const mockRedisLRange = jest.fn().mockResolvedValue([]);
const mockRedisExpire = jest.fn().mockResolvedValue(true);
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ lPush: (...a: unknown[]) => mockRedisLPush(...a), lTrim: (...a: unknown[]) => mockRedisLTrim(...a), lRange: (...a: unknown[]) => mockRedisLRange(...a), expire: (...a: unknown[]) => mockRedisExpire(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantAPILogService } from '../../src/services/merchant-api-log.service';

describe('MerchantAPILogService', () => {
  let s: MerchantAPILogService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantAPILogService(); mockRedisLRange.mockResolvedValue([]); });

  it('logs request', async () => { const e = await s.logRequest({ merchantId: 'm1', method: 'GET', endpoint: '/api/v1/payments', statusCode: 200, responseMs: 45, ipAddress: '1.2.3.4', userAgent: 'curl', requestBody: null, error: null }); expect(e.id).toMatch(/^alog_/); expect(mockRedisLPush).toHaveBeenCalled(); });
  it('returns empty', async () => { expect(await s.getLogs('m1')).toEqual([]); });
  it('filters errors', async () => {
    mockRedisLRange.mockResolvedValue([JSON.stringify({ statusCode: 200 }), JSON.stringify({ statusCode: 500 }), JSON.stringify({ statusCode: 404 })]);
    const errors = await s.getErrorLogs('m1');
    expect(errors).toHaveLength(2);
  });
  it('finds slow requests', async () => {
    mockRedisLRange.mockResolvedValue([JSON.stringify({ responseMs: 50 }), JSON.stringify({ responseMs: 2000 }), JSON.stringify({ responseMs: 1500 })]);
    const slow = await s.getSlowRequests('m1', 1000);
    expect(slow).toHaveLength(2);
    expect(slow[0].responseMs).toBe(2000);
  });
  it('calculates avg response', async () => {
    mockRedisLRange.mockResolvedValue([JSON.stringify({ responseMs: 100 }), JSON.stringify({ responseMs: 200 }), JSON.stringify({ responseMs: 300 })]);
    expect(await s.getAvgResponseTime('m1')).toBe(200);
  });
  it('returns 0 avg for empty', async () => { expect(await s.getAvgResponseTime('m1')).toBe(0); });
});
