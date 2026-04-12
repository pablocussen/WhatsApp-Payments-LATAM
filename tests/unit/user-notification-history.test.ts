const mockRedisLPush = jest.fn().mockResolvedValue(1);
const mockRedisLTrim = jest.fn().mockResolvedValue('OK');
const mockRedisLRange = jest.fn().mockResolvedValue([]);
const mockRedisExpire = jest.fn().mockResolvedValue(true);
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({
  lPush: (...a: unknown[]) => mockRedisLPush(...a), lTrim: (...a: unknown[]) => mockRedisLTrim(...a),
  lRange: (...a: unknown[]) => mockRedisLRange(...a), expire: (...a: unknown[]) => mockRedisExpire(...a),
}) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserNotificationHistoryService } from '../../src/services/user-notification-history.service';

describe('UserNotificationHistoryService', () => {
  let s: UserNotificationHistoryService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserNotificationHistoryService(); mockRedisLRange.mockResolvedValue([]); });

  it('adds notification', async () => { const n = await s.addNotification({ userId: 'u1', title: 'Pago recibido', body: '$5.000 de Juan', type: 'PAYMENT', actionUrl: null }); expect(n.id).toMatch(/^unotif_/); expect(n.read).toBe(false); });
  it('returns empty', async () => { expect(await s.getNotifications('u1')).toEqual([]); });
  it('returns parsed', async () => { mockRedisLRange.mockResolvedValue([JSON.stringify({ id: 'n1', read: false })]); expect(await s.getNotifications('u1')).toHaveLength(1); });
  it('counts unread', async () => { mockRedisLRange.mockResolvedValue([JSON.stringify({ read: false }), JSON.stringify({ read: true }), JSON.stringify({ read: false })]); expect(await s.getUnreadCount('u1')).toBe(2); });
  it('returns 0 unread for empty', async () => { expect(await s.getUnreadCount('u1')).toBe(0); });
});
