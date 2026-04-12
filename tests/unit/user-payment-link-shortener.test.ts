const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserPaymentLinkShortenerService } from '../../src/services/user-payment-link-shortener.service';

describe('UserPaymentLinkShortenerService', () => {
  let s: UserPaymentLinkShortenerService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserPaymentLinkShortenerService(); mockRedisGet.mockResolvedValue(null); });

  it('creates short link', async () => {
    const l = await s.createShortLink('u1', 'https://whatpay.cl/pay/abc123');
    expect(l.shortCode).toHaveLength(7);
    expect(l.clicks).toBe(0);
    expect(l.active).toBe(true);
  });

  it('rejects HTTP URL', async () => {
    await expect(s.createShortLink('u1', 'http://example.com')).rejects.toThrow('HTTPS');
  });

  it('rejects invalid expiration', async () => {
    await expect(s.createShortLink('u1', 'https://x.cl', 500)).rejects.toThrow('365');
  });

  it('resolves active link', async () => {
    const future = new Date(Date.now() + 100000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify({ shortCode: 'abc', originalUrl: 'https://x.cl', active: true, expiresAt: future, clicks: 0 }));
    const r = await s.resolve('abc');
    expect(r?.url).toBe('https://x.cl');
  });

  it('rejects expired link', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ active: true, expiresAt: '2020-01-01' }));
    expect(await s.resolve('abc')).toBeNull();
  });

  it('rejects inactive link', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ active: false }));
    expect(await s.resolve('abc')).toBeNull();
  });

  it('deactivates link', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ shortCode: 'abc', active: true }));
    expect(await s.deactivate('abc')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.active).toBe(false);
  });

  it('generates full URL', () => {
    expect(s.getFullUrl('abc123')).toBe('https://whatpay.cl/s/abc123');
  });
});
