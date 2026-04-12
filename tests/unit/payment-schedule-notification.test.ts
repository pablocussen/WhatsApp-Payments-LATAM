const mockRedisLPush = jest.fn().mockResolvedValue(1);
const mockRedisLTrim = jest.fn().mockResolvedValue('OK');
const mockRedisLRange = jest.fn().mockResolvedValue([]);
const mockRedisExpire = jest.fn().mockResolvedValue(true);
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ lPush: (...a: unknown[]) => mockRedisLPush(...a), lTrim: (...a: unknown[]) => mockRedisLTrim(...a), lRange: (...a: unknown[]) => mockRedisLRange(...a), expire: (...a: unknown[]) => mockRedisExpire(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { PaymentScheduleNotificationService } from '../../src/services/payment-schedule-notification.service';

describe('PaymentScheduleNotificationService', () => {
  let s: PaymentScheduleNotificationService;
  beforeEach(() => { jest.clearAllMocks(); s = new PaymentScheduleNotificationService(); mockRedisLRange.mockResolvedValue([]); });

  it('creates notification', async () => { const n = await s.notify({ userId: 'u1', ruleId: 'r1', type: 'UPCOMING', amount: 50000, recipientPhone: '+569', message: 'Pago viene' }); expect(n.id).toMatch(/^psn_/); expect(n.read).toBe(false); });
  it('returns empty', async () => { expect(await s.getNotifications('u1')).toEqual([]); });
  it('returns parsed', async () => { mockRedisLRange.mockResolvedValue([JSON.stringify({ id: 'psn_1' })]); expect(await s.getNotifications('u1')).toHaveLength(1); });
  it('formats upcoming', () => { expect(s.formatUpcoming(50000, '+569', '15/04')).toContain('$50.000'); });
  it('formats executed', () => { expect(s.formatExecuted(50000, '+569', '#WP-1')).toContain('ejecutado'); });
  it('formats failed', () => { expect(s.formatFailed(50000, '+569', 'Saldo insuficiente')).toContain('fallido'); });
});
