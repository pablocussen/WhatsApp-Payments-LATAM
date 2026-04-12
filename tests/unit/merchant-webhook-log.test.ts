const mockRedisLPush = jest.fn().mockResolvedValue(1);
const mockRedisLTrim = jest.fn().mockResolvedValue('OK');
const mockRedisLRange = jest.fn().mockResolvedValue([]);
const mockRedisExpire = jest.fn().mockResolvedValue(true);
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ lPush: (...a: unknown[]) => mockRedisLPush(...a), lTrim: (...a: unknown[]) => mockRedisLTrim(...a), lRange: (...a: unknown[]) => mockRedisLRange(...a), expire: (...a: unknown[]) => mockRedisExpire(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantWebhookLogService } from '../../src/services/merchant-webhook-log.service';

describe('MerchantWebhookLogService', () => {
  let s: MerchantWebhookLogService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantWebhookLogService(); mockRedisLRange.mockResolvedValue([]); });

  it('logs delivery', async () => { const e = await s.logDelivery({ merchantId: 'm1', subscriptionId: 's1', event: 'payment.completed', url: 'https://x.cl/wh', statusCode: 200, responseMs: 150, success: true, attempt: 1, error: null, payload: '{}' }); expect(e.id).toMatch(/^whlog_/); });
  it('returns empty', async () => { expect(await s.getLogs('m1')).toEqual([]); });
  it('filters failed', async () => {
    mockRedisLRange.mockResolvedValue([JSON.stringify({ success: true }), JSON.stringify({ success: false }), JSON.stringify({ success: false })]);
    expect(await s.getFailedDeliveries('m1')).toHaveLength(2);
  });
  it('calculates success rate', async () => {
    mockRedisLRange.mockResolvedValue([JSON.stringify({ success: true }), JSON.stringify({ success: true }), JSON.stringify({ success: false })]);
    expect(await s.getSuccessRate('m1')).toBe(67);
  });
  it('returns 100% for empty', async () => { expect(await s.getSuccessRate('m1')).toBe(100); });
  it('calculates avg response', async () => {
    mockRedisLRange.mockResolvedValue([JSON.stringify({ responseMs: 100 }), JSON.stringify({ responseMs: 200 }), JSON.stringify({ responseMs: null })]);
    expect(await s.getAvgResponseTime('m1')).toBe(150);
  });
});
