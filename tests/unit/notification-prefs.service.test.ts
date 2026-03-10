/**
 * Unit tests for NotificationPrefsService.
 * Redis is fully mocked — no connection required.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test' },
}));

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  }),
}));

import { NotificationPrefsService } from '../../src/services/notification-prefs.service';

describe('NotificationPrefsService', () => {
  let svc: NotificationPrefsService;

  beforeEach(() => {
    svc = new NotificationPrefsService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
  });

  // ─── get ─────────────────────────────────────────────

  describe('get', () => {
    it('returns defaults when no prefs stored', async () => {
      const prefs = await svc.get('uid-1');
      expect(prefs.enabled).toBe(true);
      expect(prefs.quietHoursEnabled).toBe(false);
      expect(prefs.quietStart).toBe(23);
      expect(prefs.quietEnd).toBe(7);
    });

    it('returns stored prefs merged with defaults', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ enabled: false }));
      const prefs = await svc.get('uid-1');
      expect(prefs.enabled).toBe(false);
      expect(prefs.quietHoursEnabled).toBe(false); // default
    });

    it('returns defaults on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const prefs = await svc.get('uid-1');
      expect(prefs.enabled).toBe(true);
    });
  });

  // ─── set ─────────────────────────────────────────────

  describe('set', () => {
    it('merges partial prefs with current', async () => {
      const result = await svc.set('uid-1', { enabled: false });
      expect(result.enabled).toBe(false);
      expect(result.quietHoursEnabled).toBe(false);
      expect(mockRedisSet).toHaveBeenCalledWith(
        'notif-prefs:uid-1',
        expect.any(String),
        { EX: 90 * 24 * 60 * 60 },
      );
    });

    it('does not throw on Redis write error', async () => {
      mockRedisSet.mockRejectedValue(new Error('Write failed'));
      const result = await svc.set('uid-1', { enabled: false });
      expect(result.enabled).toBe(false); // returns merged prefs despite error
    });
  });

  // ─── toggleEnabled ───────────────────────────────────

  describe('toggleEnabled', () => {
    it('toggles enabled from true to false', async () => {
      const result = await svc.toggleEnabled('uid-1');
      expect(result.enabled).toBe(false);
    });

    it('toggles enabled from false to true', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ enabled: false }));
      const result = await svc.toggleEnabled('uid-1');
      expect(result.enabled).toBe(true);
    });
  });

  // ─── setQuietHours ───────────────────────────────────

  describe('setQuietHours', () => {
    it('sets quiet hours and enables them', async () => {
      const result = await svc.setQuietHours('uid-1', 22, 8);
      expect(result.quietHoursEnabled).toBe(true);
      expect(result.quietStart).toBe(22);
      expect(result.quietEnd).toBe(8);
    });

    it('rejects invalid start hour', async () => {
      await expect(svc.setQuietHours('uid-1', -1, 8)).rejects.toThrow('entre 0 y 23');
      await expect(svc.setQuietHours('uid-1', 24, 8)).rejects.toThrow('entre 0 y 23');
    });

    it('rejects invalid end hour', async () => {
      await expect(svc.setQuietHours('uid-1', 22, -1)).rejects.toThrow('entre 0 y 23');
      await expect(svc.setQuietHours('uid-1', 22, 24)).rejects.toThrow('entre 0 y 23');
    });
  });

  // ─── disableQuietHours ───────────────────────────────

  describe('disableQuietHours', () => {
    it('disables quiet hours', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ quietHoursEnabled: true, quietStart: 22, quietEnd: 8 }));
      const result = await svc.disableQuietHours('uid-1');
      expect(result.quietHoursEnabled).toBe(false);
      expect(result.quietStart).toBe(22); // preserved
    });
  });

  // ─── shouldNotify ────────────────────────────────────

  describe('shouldNotify', () => {
    it('returns true when enabled with no quiet hours', async () => {
      expect(await svc.shouldNotify('uid-1')).toBe(true);
    });

    it('returns false when notifications disabled', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ enabled: false }));
      expect(await svc.shouldNotify('uid-1')).toBe(false);
    });

    it('returns true when quiet hours enabled but not in range', async () => {
      // Mock Intl.DateTimeFormat to return hour 12 (noon — outside 23-7)
      const origFormat = Intl.DateTimeFormat;
      jest.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
        format: () => '12',
        formatToParts: jest.fn(),
        resolvedOptions: jest.fn(),
        formatRange: jest.fn(),
        formatRangeToParts: jest.fn(),
      } as unknown as Intl.DateTimeFormat);

      mockRedisGet.mockResolvedValue(JSON.stringify({ enabled: true, quietHoursEnabled: true, quietStart: 23, quietEnd: 7 }));
      expect(await svc.shouldNotify('uid-1')).toBe(true);

      Intl.DateTimeFormat = origFormat;
    });

    it('returns false when in quiet hours (spans midnight)', async () => {
      jest.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
        format: () => '2',
        formatToParts: jest.fn(),
        resolvedOptions: jest.fn(),
        formatRange: jest.fn(),
        formatRangeToParts: jest.fn(),
      } as unknown as Intl.DateTimeFormat);

      mockRedisGet.mockResolvedValue(JSON.stringify({ enabled: true, quietHoursEnabled: true, quietStart: 23, quietEnd: 7 }));
      expect(await svc.shouldNotify('uid-1')).toBe(false);

      jest.restoreAllMocks();
    });

    it('returns false when in quiet hours (same day range)', async () => {
      jest.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
        format: () => '15',
        formatToParts: jest.fn(),
        resolvedOptions: jest.fn(),
        formatRange: jest.fn(),
        formatRangeToParts: jest.fn(),
      } as unknown as Intl.DateTimeFormat);

      mockRedisGet.mockResolvedValue(JSON.stringify({ enabled: true, quietHoursEnabled: true, quietStart: 14, quietEnd: 16 }));
      expect(await svc.shouldNotify('uid-1')).toBe(false);

      jest.restoreAllMocks();
    });

    it('returns true outside same-day quiet hours', async () => {
      jest.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
        format: () => '10',
        formatToParts: jest.fn(),
        resolvedOptions: jest.fn(),
        formatRange: jest.fn(),
        formatRangeToParts: jest.fn(),
      } as unknown as Intl.DateTimeFormat);

      mockRedisGet.mockResolvedValue(JSON.stringify({ enabled: true, quietHoursEnabled: true, quietStart: 14, quietEnd: 16 }));
      expect(await svc.shouldNotify('uid-1')).toBe(true);

      jest.restoreAllMocks();
    });
  });
});
