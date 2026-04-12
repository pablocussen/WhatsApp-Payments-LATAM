const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantQRProfileService } from '../../src/services/merchant-qr-profile.service';

describe('MerchantQRProfileService', () => {
  let s: MerchantQRProfileService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantQRProfileService(); mockRedisGet.mockResolvedValue(null); });

  it('returns defaults', async () => { const p = await s.getProfile('m1'); expect(p.theme).toBe('DARK'); expect(p.brandColor).toBe('#06b6d4'); });
  it('updates display name', async () => { const p = await s.updateProfile('m1', { displayName: 'Café Central' }); expect(p.displayName).toBe('Café Central'); });
  it('rejects long name', async () => { await expect(s.updateProfile('m1', { displayName: 'x'.repeat(51) })).rejects.toThrow('50'); });
  it('rejects invalid color', async () => { await expect(s.updateProfile('m1', { brandColor: 'red' })).rejects.toThrow('hex'); });
  it('accepts valid color', async () => { const p = await s.updateProfile('m1', { brandColor: '#FF5733' }); expect(p.brandColor).toBe('#FF5733'); });
  it('updates social', async () => { const p = await s.updateProfile('m1', { showSocial: true, instagram: '@cafe', website: 'cafe.cl' }); expect(p.showSocial).toBe(true); expect(p.instagram).toBe('@cafe'); });
  it('generates QR data', async () => { const p = await s.getProfile('m1'); p.displayName = 'Test'; p.merchantId = 'm1'; const qr = s.generateQRData(p); expect(qr).toContain('whatpay://pay?'); expect(qr).toContain('m=m1'); });
  it('includes amount in QR', async () => { const p = await s.getProfile('m1'); p.displayName = 'Test'; p.defaultAmount = 5000; const qr = s.generateQRData(p); expect(qr).toContain('a=5000'); });
});
