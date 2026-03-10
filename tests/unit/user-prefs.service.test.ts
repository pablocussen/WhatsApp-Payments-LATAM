/**
 * Unit tests for UserPrefsService.
 * Redis is fully mocked.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisDel = jest.fn().mockResolvedValue(1);

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test' },
}));

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
  }),
}));

import { UserPrefsService } from '../../src/services/user-prefs.service';

describe('UserPrefsService', () => {
  let svc: UserPrefsService;

  beforeEach(() => {
    svc = new UserPrefsService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRedisDel.mockResolvedValue(1);
  });

  // ─── getPrefs ──────────────────────────────────────────

  describe('getPrefs', () => {
    it('returns defaults when no prefs stored', async () => {
      const prefs = await svc.getPrefs('uid-1');
      expect(prefs.language).toBe('es');
      expect(prefs.receiptFormat).toBe('short');
      expect(prefs.confirmBeforePay).toBe(true);
      expect(prefs.showBalanceOnGreet).toBe(false);
      expect(prefs.defaultTipPercent).toBe(0);
      expect(prefs.nickName).toBeNull();
    });

    it('returns stored prefs merged with defaults', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ language: 'en', nickName: 'Pablo' }));
      const prefs = await svc.getPrefs('uid-1');
      expect(prefs.language).toBe('en');
      expect(prefs.nickName).toBe('Pablo');
      expect(prefs.receiptFormat).toBe('short'); // default
    });

    it('returns defaults on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const prefs = await svc.getPrefs('uid-1');
      expect(prefs.language).toBe('es');
    });
  });

  // ─── setPrefs ──────────────────────────────────────────

  describe('setPrefs', () => {
    it('updates language', async () => {
      const prefs = await svc.setPrefs('uid-1', { language: 'en' });
      expect(prefs.language).toBe('en');
      expect(mockRedisSet).toHaveBeenCalledWith(
        'prefs:user:uid-1',
        expect.stringContaining('"language":"en"'),
        { EX: 365 * 24 * 60 * 60 },
      );
    });

    it('updates receipt format', async () => {
      const prefs = await svc.setPrefs('uid-1', { receiptFormat: 'detailed' });
      expect(prefs.receiptFormat).toBe('detailed');
    });

    it('updates confirm before pay', async () => {
      const prefs = await svc.setPrefs('uid-1', { confirmBeforePay: false });
      expect(prefs.confirmBeforePay).toBe(false);
    });

    it('updates show balance on greet', async () => {
      const prefs = await svc.setPrefs('uid-1', { showBalanceOnGreet: true });
      expect(prefs.showBalanceOnGreet).toBe(true);
    });

    it('updates default tip percent', async () => {
      const prefs = await svc.setPrefs('uid-1', { defaultTipPercent: 10 });
      expect(prefs.defaultTipPercent).toBe(10);
    });

    it('updates nickname', async () => {
      const prefs = await svc.setPrefs('uid-1', { nickName: 'Pablito' });
      expect(prefs.nickName).toBe('Pablito');
    });

    it('merges with existing prefs', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ language: 'en', defaultTipPercent: 5 }));
      const prefs = await svc.setPrefs('uid-1', { nickName: 'Test' });
      expect(prefs.language).toBe('en');
      expect(prefs.defaultTipPercent).toBe(5);
      expect(prefs.nickName).toBe('Test');
    });

    it('rejects invalid language', async () => {
      await expect(svc.setPrefs('uid-1', { language: 'fr' as never }))
        .rejects.toThrow('Idioma no soportado');
    });

    it('rejects invalid receipt format', async () => {
      await expect(svc.setPrefs('uid-1', { receiptFormat: 'xml' as never }))
        .rejects.toThrow('Formato de recibo inválido');
    });

    it('rejects tip percent > 20', async () => {
      await expect(svc.setPrefs('uid-1', { defaultTipPercent: 25 }))
        .rejects.toThrow('Propina debe estar entre 0% y 20%');
    });

    it('rejects negative tip percent', async () => {
      await expect(svc.setPrefs('uid-1', { defaultTipPercent: -5 }))
        .rejects.toThrow('Propina debe estar entre 0% y 20%');
    });

    it('rejects nickname over 30 chars', async () => {
      await expect(svc.setPrefs('uid-1', { nickName: 'x'.repeat(31) }))
        .rejects.toThrow('Nombre debe tener máximo 30 caracteres');
    });

    it('does not throw on Redis save error', async () => {
      mockRedisSet.mockRejectedValue(new Error('Redis down'));
      const prefs = await svc.setPrefs('uid-1', { language: 'en' });
      expect(prefs.language).toBe('en');
    });
  });

  // ─── resetPrefs ────────────────────────────────────────

  describe('resetPrefs', () => {
    it('deletes prefs from Redis and returns defaults', async () => {
      const prefs = await svc.resetPrefs('uid-1');
      expect(mockRedisDel).toHaveBeenCalledWith('prefs:user:uid-1');
      expect(prefs.language).toBe('es');
      expect(prefs.confirmBeforePay).toBe(true);
    });

    it('does not throw on Redis error', async () => {
      mockRedisDel.mockRejectedValue(new Error('Redis down'));
      const prefs = await svc.resetPrefs('uid-1');
      expect(prefs.language).toBe('es');
    });
  });

  // ─── getPref ───────────────────────────────────────────

  describe('getPref', () => {
    it('returns single preference value', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ language: 'en' }));
      const lang = await svc.getPref('uid-1', 'language');
      expect(lang).toBe('en');
    });

    it('returns default for unset preference', async () => {
      const tip = await svc.getPref('uid-1', 'defaultTipPercent');
      expect(tip).toBe(0);
    });
  });
});
