/**
 * UserSettingsService — user preferences and configuration.
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

import { UserSettingsService } from '../../src/services/user-settings.service';

describe('UserSettingsService', () => {
  let service: UserSettingsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UserSettingsService();
    mockRedisGet.mockResolvedValue(null);
  });

  it('returns defaults for new user', async () => {
    const s = await service.getSettings('u1');
    expect(s.language).toBe('es');
    expect(s.displayCurrency).toBe('CLP');
    expect(s.notifMode).toBe('ALL');
    expect(s.confirmBeforeSend).toBe(true);
    expect(s.twoFactorEnabled).toBe(false);
    expect(s.timezone).toBe('America/Santiago');
  });

  it('returns stored settings', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ userId: 'u1', language: 'en', displayCurrency: 'USD' }));
    const s = await service.getSettings('u1');
    expect(s.language).toBe('en');
    expect(s.displayCurrency).toBe('USD');
  });

  it('updates language', async () => {
    const s = await service.updateSettings('u1', { language: 'en' });
    expect(s.language).toBe('en');
    expect(mockRedisSet).toHaveBeenCalled();
  });

  it('rejects invalid language', async () => {
    await expect(service.updateSettings('u1', { language: 'fr' as any })).rejects.toThrow('inválido');
  });

  it('updates currency', async () => {
    const s = await service.updateSettings('u1', { displayCurrency: 'UF' });
    expect(s.displayCurrency).toBe('UF');
  });

  it('rejects invalid currency', async () => {
    await expect(service.updateSettings('u1', { displayCurrency: 'EUR' as any })).rejects.toThrow('inválida');
  });

  it('updates boolean settings', async () => {
    const s = await service.updateSettings('u1', {
      showBalance: false, confirmBeforeSend: false, dailySummary: true, twoFactorEnabled: true,
    });
    expect(s.showBalance).toBe(false);
    expect(s.confirmBeforeSend).toBe(false);
    expect(s.dailySummary).toBe(true);
    expect(s.twoFactorEnabled).toBe(true);
  });

  it('resets to defaults', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ userId: 'u1', language: 'en', displayCurrency: 'USD' }));
    const s = await service.resetToDefaults('u1');
    expect(s.language).toBe('es');
    expect(s.displayCurrency).toBe('CLP');
  });

  it('formats summary', async () => {
    const s = await service.getSettings('u1');
    const summary = service.getSettingsSummary(s);
    expect(summary).toContain('Español');
    expect(summary).toContain('CLP');
    expect(summary).toContain('ALL');
    expect(summary).toContain('Sí');
    expect(summary).toContain('Inactivo');
  });
});
