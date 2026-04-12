const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserReferralLinkService } from '../../src/services/user-referral-link.service';

describe('UserReferralLinkService', () => {
  let s: UserReferralLinkService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserReferralLinkService(); mockRedisGet.mockResolvedValue(null); });

  it('creates link with unique code', async () => { const l = await s.createLink('u1'); expect(l.code).toMatch(/^WP/); expect(l.url).toContain('whatpay.cl/r/'); expect(l.clicks).toBe(0); });
  it('returns null for missing', async () => { expect(await s.getLink('NOPE')).toBeNull(); });
  it('records click', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ code: 'WPX', clicks: 5, signups: 1, conversionRate: 20 }));
    await s.recordClick('WPX');
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.clicks).toBe(6);
  });
  it('records signup and updates conversion', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ code: 'WPX', clicks: 10, signups: 2, conversionRate: 20 }));
    await s.recordSignup('WPX');
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.signups).toBe(3); expect(saved.conversionRate).toBe(30);
  });
});
