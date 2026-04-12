const mockRedisLPush = jest.fn().mockResolvedValue(1);
const mockRedisLTrim = jest.fn().mockResolvedValue('OK');
const mockRedisLRange = jest.fn().mockResolvedValue([]);
const mockRedisExpire = jest.fn().mockResolvedValue(true);
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ lPush: (...a: unknown[]) => mockRedisLPush(...a), lTrim: (...a: unknown[]) => mockRedisLTrim(...a), lRange: (...a: unknown[]) => mockRedisLRange(...a), expire: (...a: unknown[]) => mockRedisExpire(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantNotificationLogService } from '../../src/services/merchant-notification-log.service';

describe('MerchantNotificationLogService', () => {
  let s: MerchantNotificationLogService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantNotificationLogService(); mockRedisLRange.mockResolvedValue([]); });

  it('logs notification', async () => { const l = await s.logNotification({ merchantId: 'm1', channel: 'WHATSAPP', event: 'payment.completed', recipient: '+569', status: 'SENT', errorMessage: null }); expect(l.id).toMatch(/^nlog_/); expect(mockRedisLPush).toHaveBeenCalled(); });
  it('returns empty for new merchant', async () => { expect(await s.getLogs('m1')).toEqual([]); });
  it('returns parsed logs', async () => {
    mockRedisLRange.mockResolvedValue([JSON.stringify({ id: 'nlog_1', status: 'SENT' }), JSON.stringify({ id: 'nlog_2', status: 'FAILED' })]);
    const logs = await s.getLogs('m1');
    expect(logs).toHaveLength(2);
  });
  it('counts failed', async () => {
    mockRedisLRange.mockResolvedValue([JSON.stringify({ status: 'SENT' }), JSON.stringify({ status: 'FAILED' }), JSON.stringify({ status: 'BOUNCED' })]);
    expect(await s.getFailedCount('m1')).toBe(2);
  });
  it('calculates delivery rate', async () => {
    mockRedisLRange.mockResolvedValue([JSON.stringify({ status: 'SENT' }), JSON.stringify({ status: 'DELIVERED' }), JSON.stringify({ status: 'FAILED' })]);
    expect(await s.getDeliveryRate('m1')).toBe(67);
  });
  it('returns 100% for no logs', async () => { expect(await s.getDeliveryRate('m1')).toBe(100); });
});
