const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantBrandingService } from '../../src/services/merchant-branding.service';

describe('MerchantBrandingService', () => {
  let s: MerchantBrandingService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantBrandingService(); mockRedisGet.mockResolvedValue(null); });

  it('returns defaults', async () => { const b = await s.getBranding('m1'); expect(b.primaryColor).toBe('#06b6d4'); expect(b.fontFamily).toBe('Inter'); });
  it('updates colors', async () => { const b = await s.updateBranding('m1', { primaryColor: '#FF0000', secondaryColor: '#00FF00' }); expect(b.primaryColor).toBe('#FF0000'); });
  it('rejects invalid color', async () => { await expect(s.updateBranding('m1', { primaryColor: 'blue' })).rejects.toThrow('hex'); });
  it('updates messages', async () => { const b = await s.updateBranding('m1', { welcomeMessage: 'Hola!' }); expect(b.welcomeMessage).toBe('Hola!'); });
  it('rejects long welcome', async () => { await expect(s.updateBranding('m1', { welcomeMessage: 'x'.repeat(201) })).rejects.toThrow('200'); });
  it('rejects over 5 social links', async () => { const links = Array.from({ length: 6 }, () => ({ platform: 'ig', url: 'x' })); await expect(s.updateBranding('m1', { socialLinks: links })).rejects.toThrow('5'); });
  it('generates theme CSS', async () => { const b = await s.getBranding('m1'); const css = s.generateThemeCSS(b); expect(css).toContain('#06b6d4'); expect(css).toContain('Inter'); });
});
