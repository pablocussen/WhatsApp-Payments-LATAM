/**
 * MerchantNotifPrefsService — notification preferences per merchant.
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

import { MerchantNotifPrefsService } from '../../src/services/merchant-notification-prefs.service';

describe('MerchantNotifPrefsService', () => {
  let service: MerchantNotifPrefsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MerchantNotifPrefsService();
    mockRedisGet.mockResolvedValue(null);
  });

  // ── getPrefs ──────────────────────────────────────

  it('returns defaults for new merchant', async () => {
    const prefs = await service.getPrefs('m1');
    expect(prefs.merchantId).toBe('m1');
    expect(prefs.enabled).toBe(true);
    expect(prefs.channels.PAYMENT_RECEIVED).toEqual(['WHATSAPP']);
    expect(prefs.channels.PAYOUT_COMPLETED).toEqual(['WHATSAPP', 'EMAIL']);
    expect(prefs.timezone).toBe('America/Santiago');
  });

  it('returns stored prefs', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      merchantId: 'm1', enabled: false, channels: {},
    }));
    const prefs = await service.getPrefs('m1');
    expect(prefs.enabled).toBe(false);
  });

  // ── updatePrefs ───────────────────────────────────

  it('updates email and webhook', async () => {
    const prefs = await service.updatePrefs('m1', {
      emailAddress: 'test@merchant.cl',
      webhookUrl: 'https://merchant.cl/webhook',
    });
    expect(prefs.emailAddress).toBe('test@merchant.cl');
    expect(prefs.webhookUrl).toBe('https://merchant.cl/webhook');
    expect(mockRedisSet).toHaveBeenCalled();
  });

  it('updates quiet hours', async () => {
    const prefs = await service.updatePrefs('m1', {
      quietHoursStart: 22, quietHoursEnd: 7,
    });
    expect(prefs.quietHoursStart).toBe(22);
    expect(prefs.quietHoursEnd).toBe(7);
  });

  it('disables notifications', async () => {
    const prefs = await service.updatePrefs('m1', { enabled: false });
    expect(prefs.enabled).toBe(false);
  });

  // ── setChannelForEvent ────────────────────────────

  it('sets channels for specific event', async () => {
    const prefs = await service.setChannelForEvent('m1', 'PAYMENT_RECEIVED', ['WHATSAPP', 'EMAIL', 'WEBHOOK']);
    expect(prefs.channels.PAYMENT_RECEIVED).toEqual(['WHATSAPP', 'EMAIL', 'WEBHOOK']);
  });

  it('rejects invalid event', async () => {
    await expect(service.setChannelForEvent('m1', 'INVALID' as any, ['WHATSAPP']))
      .rejects.toThrow('invalido');
  });

  it('rejects invalid channel', async () => {
    await expect(service.setChannelForEvent('m1', 'PAYMENT_RECEIVED', ['SMS' as any]))
      .rejects.toThrow('invalido');
  });

  // ── shouldNotify ──────────────────────────────────

  it('returns channels when enabled', () => {
    const result = service.shouldNotify({
      merchantId: 'm1', channels: { PAYMENT_RECEIVED: ['WHATSAPP'], PAYOUT_COMPLETED: [], PAYOUT_FAILED: [], DISPUTE_OPENED: [], DAILY_SUMMARY: [], LOW_BALANCE: [] },
      quietHoursStart: null, quietHoursEnd: null, timezone: 'America/Santiago',
      emailAddress: null, webhookUrl: null, enabled: true, updatedAt: '',
    }, 'PAYMENT_RECEIVED');
    expect(result.notify).toBe(true);
    expect(result.channels).toEqual(['WHATSAPP']);
  });

  it('returns false when disabled', () => {
    const result = service.shouldNotify({
      merchantId: 'm1', channels: { PAYMENT_RECEIVED: ['WHATSAPP'], PAYOUT_COMPLETED: [], PAYOUT_FAILED: [], DISPUTE_OPENED: [], DAILY_SUMMARY: [], LOW_BALANCE: [] },
      quietHoursStart: null, quietHoursEnd: null, timezone: 'America/Santiago',
      emailAddress: null, webhookUrl: null, enabled: false, updatedAt: '',
    }, 'PAYMENT_RECEIVED');
    expect(result.notify).toBe(false);
  });

  it('returns false when no channels configured', () => {
    const result = service.shouldNotify({
      merchantId: 'm1', channels: { PAYMENT_RECEIVED: [], PAYOUT_COMPLETED: [], PAYOUT_FAILED: [], DISPUTE_OPENED: [], DAILY_SUMMARY: [], LOW_BALANCE: [] },
      quietHoursStart: null, quietHoursEnd: null, timezone: 'America/Santiago',
      emailAddress: null, webhookUrl: null, enabled: true, updatedAt: '',
    }, 'PAYMENT_RECEIVED');
    expect(result.notify).toBe(false);
  });

  it('filters to async channels during quiet hours', () => {
    // Mock current hour — quiet hours 0-23 (always quiet for test)
    const result = service.shouldNotify({
      merchantId: 'm1', channels: { PAYMENT_RECEIVED: ['WHATSAPP', 'EMAIL', 'WEBHOOK'], PAYOUT_COMPLETED: [], PAYOUT_FAILED: [], DISPUTE_OPENED: [], DAILY_SUMMARY: [], LOW_BALANCE: [] },
      quietHoursStart: 0, quietHoursEnd: 23, timezone: 'America/Santiago',
      emailAddress: 'a@b.cl', webhookUrl: null, enabled: true, updatedAt: '',
    }, 'PAYMENT_RECEIVED');
    expect(result.notify).toBe(true);
    expect(result.channels).not.toContain('WHATSAPP');
    expect(result.channels).toContain('EMAIL');
  });

  // ── getEventLabel ─────────────────────────────────

  it('returns Spanish labels', () => {
    expect(service.getEventLabel('PAYMENT_RECEIVED')).toBe('Pago recibido');
    expect(service.getEventLabel('DISPUTE_OPENED')).toBe('Disputa abierta');
  });
});
