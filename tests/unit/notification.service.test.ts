/**
 * NotificationService — centralized notification system.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisLPush = jest.fn().mockResolvedValue(1);
const mockRedisLTrim = jest.fn().mockResolvedValue('OK');
const mockRedisLRange = jest.fn().mockResolvedValue([]);

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    lPush: (...args: unknown[]) => mockRedisLPush(...args),
    lTrim: (...args: unknown[]) => mockRedisLTrim(...args),
    lRange: (...args: unknown[]) => mockRedisLRange(...args),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { NotificationService } from '../../src/services/notification.service';

describe('NotificationService', () => {
  let service: NotificationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new NotificationService();
    mockRedisGet.mockResolvedValue(null);
  });

  // ── create ────────────────────────────────────────

  it('creates notification with ID and timestamp', async () => {
    const notif = await service.create({
      userId: 'user-1',
      type: 'payment_received',
      title: 'Pago recibido',
      body: 'Juan te envió $5.000',
    });

    expect(notif.id).toMatch(/^ntf_/);
    expect(notif.userId).toBe('user-1');
    expect(notif.type).toBe('payment_received');
    expect(notif.read).toBe(false);
    expect(notif.createdAt).toBeTruthy();
  });

  it('stores in Redis and adds to user list', async () => {
    await service.create({
      userId: 'user-1', type: 'payment_received',
      title: 'Test', body: 'Test body',
    });

    expect(mockRedisSet).toHaveBeenCalled();
    expect(mockRedisLPush).toHaveBeenCalledWith('notif:user:user-1', expect.stringMatching(/^ntf_/));
    expect(mockRedisLTrim).toHaveBeenCalledWith('notif:user:user-1', 0, 49);
  });

  // ── getUserNotifications ──────────────────────────

  it('returns user notifications', async () => {
    mockRedisLRange.mockResolvedValue(['ntf_1', 'ntf_2']);
    mockRedisGet
      .mockResolvedValueOnce(JSON.stringify({ id: 'ntf_1', type: 'payment_received', read: false }))
      .mockResolvedValueOnce(JSON.stringify({ id: 'ntf_2', type: 'tip_received', read: true }));

    const results = await service.getUserNotifications('user-1');
    expect(results).toHaveLength(2);
    expect(results[0].id).toBe('ntf_1');
  });

  it('returns empty array when no notifications', async () => {
    mockRedisLRange.mockResolvedValue([]);
    const results = await service.getUserNotifications('user-1');
    expect(results).toHaveLength(0);
  });

  // ── markRead ──────────────────────────────────────

  it('marks notification as read', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'ntf_1', read: false }));
    const result = await service.markRead('ntf_1');
    expect(result).toBe(true);
    const stored = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(stored.read).toBe(true);
  });

  it('returns false for non-existent notification', async () => {
    mockRedisGet.mockResolvedValue(null);
    expect(await service.markRead('ntf_nonexistent')).toBe(false);
  });

  // ── getUnreadCount ────────────────────────────────

  it('counts unread notifications', async () => {
    mockRedisLRange.mockResolvedValue(['ntf_1', 'ntf_2', 'ntf_3']);
    mockRedisGet
      .mockResolvedValueOnce(JSON.stringify({ read: false }))
      .mockResolvedValueOnce(JSON.stringify({ read: true }))
      .mockResolvedValueOnce(JSON.stringify({ read: false }));

    const count = await service.getUnreadCount('user-1');
    expect(count).toBe(2);
  });

  // ── Templated notifications ───────────────────────

  it('creates payment received notification (es)', async () => {
    const notif = await service.notifyPaymentReceived({
      receiverId: 'user-2',
      senderName: 'Juan',
      amount: 5000,
      reference: '#WP-001',
    });

    expect(notif.type).toBe('payment_received');
    expect(notif.title).toContain('Pago recibido');
    expect(notif.body).toContain('Juan');
    expect(notif.body).toContain('$5.000');
  });

  it('creates payment received notification (en)', async () => {
    const notif = await service.notifyPaymentReceived({
      receiverId: 'user-2',
      senderName: 'John',
      amount: 5000,
      reference: '#WP-001',
      locale: 'en',
    });

    expect(notif.title).toContain('Payment received');
    expect(notif.body).toContain('John');
  });

  it('creates tip received notification', async () => {
    const notif = await service.notifyTipReceived({
      receiverId: 'merchant-1',
      senderName: 'María',
      tipAmount: 1500,
      baseAmount: 10000,
    });

    expect(notif.type).toBe('tip_received');
    expect(notif.body).toContain('$1.500');
    expect(notif.body).toContain('propina');
  });

  it('creates security alert notification', async () => {
    const notif = await service.notifySecurityAlert({
      userId: 'user-1',
      message: 'Intento de login desde nueva IP',
      details: { ip: '10.0.0.1' },
    });

    expect(notif.type).toBe('security_alert');
    expect(notif.title).toContain('seguridad');
    expect(notif.data).toEqual({ ip: '10.0.0.1' });
  });
});
