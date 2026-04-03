/**
 * ConsentService — manages user consent records for legal compliance.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisSAdd = jest.fn().mockResolvedValue(1);
const mockRedisSMembers = jest.fn().mockResolvedValue([]);

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    del: jest.fn().mockResolvedValue(1),
    sAdd: (...args: unknown[]) => mockRedisSAdd(...args),
    sMembers: (...args: unknown[]) => mockRedisSMembers(...args),
    sRem: jest.fn(),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { ConsentService } from '../../src/services/consent.service';

describe('ConsentService', () => {
  let service: ConsentService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ConsentService();
    mockRedisGet.mockResolvedValue(null);
  });

  // ── Grant consent ─────────────────────────────────

  describe('grant', () => {
    it('stores consent record in Redis with TTL', async () => {
      const record = await service.grant({
        userId: 'user-1',
        waId: '56912345678',
        type: 'tos',
        version: '1.0',
        method: 'bot',
      });

      expect(record.granted).toBe(true);
      expect(record.type).toBe('tos');
      expect(record.userId).toBe('user-1');
      expect(record.version).toBe('1.0');
      expect(record.grantedAt).toMatch(/^\d{4}-/);

      expect(mockRedisSet).toHaveBeenCalledWith(
        'consent:user-1:tos',
        expect.any(String),
        { EX: 365 * 24 * 60 * 60 },
      );
      expect(mockRedisSAdd).toHaveBeenCalledWith('consent:user:user-1', 'tos');
    });

    it('defaults version to 1.0 and method to bot', async () => {
      const record = await service.grant({
        userId: 'user-2',
        waId: '56912345678',
        type: 'privacy',
      });

      expect(record.version).toBe('1.0');
      expect(record.method).toBe('bot');
    });
  });

  // ── Revoke consent ─────────────────────────────────

  describe('revoke', () => {
    it('marks consent as not granted', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({
        userId: 'user-1', type: 'marketing', granted: true, grantedAt: '2026-01-01',
      }));

      await service.revoke('user-1', 'marketing');

      const storedData = JSON.parse(mockRedisSet.mock.calls[0][1]);
      expect(storedData.granted).toBe(false);
    });

    it('does nothing if no existing consent', async () => {
      mockRedisGet.mockResolvedValue(null);
      await service.revoke('user-1', 'marketing');
      expect(mockRedisSet).not.toHaveBeenCalled();
    });
  });

  // ── Check consent ─────────────────────────────────

  describe('hasConsent', () => {
    it('returns true when consent is granted', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ granted: true }));
      expect(await service.hasConsent('user-1', 'tos')).toBe(true);
    });

    it('returns false when consent is revoked', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ granted: false }));
      expect(await service.hasConsent('user-1', 'tos')).toBe(false);
    });

    it('returns false when no consent record exists', async () => {
      mockRedisGet.mockResolvedValue(null);
      expect(await service.hasConsent('user-1', 'tos')).toBe(false);
    });
  });

  // ── Get all consents ──────────────────────────────

  describe('getUserConsents', () => {
    it('returns all consent records for a user', async () => {
      mockRedisSMembers.mockResolvedValue(['tos', 'privacy', 'messaging']);
      mockRedisGet
        .mockResolvedValueOnce(JSON.stringify({ type: 'tos', granted: true }))
        .mockResolvedValueOnce(JSON.stringify({ type: 'privacy', granted: true }))
        .mockResolvedValueOnce(JSON.stringify({ type: 'messaging', granted: true }));

      const consents = await service.getUserConsents('user-1');
      expect(consents).toHaveLength(3);
      expect(consents.map(c => c.type)).toEqual(['tos', 'privacy', 'messaging']);
    });

    it('returns empty array for user with no consents', async () => {
      mockRedisSMembers.mockResolvedValue([]);
      const consents = await service.getUserConsents('user-1');
      expect(consents).toHaveLength(0);
    });
  });

  // ── Registration consents ─────────────────────────

  describe('grantRegistrationConsents', () => {
    it('grants tos, privacy, and messaging consents', async () => {
      await service.grantRegistrationConsents({
        userId: 'user-new',
        waId: '56912345678',
      });

      // 3 consent records + 3 set entries = 6 Redis set calls
      expect(mockRedisSet).toHaveBeenCalledTimes(3);
      expect(mockRedisSAdd).toHaveBeenCalledTimes(3);

      const types = mockRedisSet.mock.calls.map(c => {
        const key = c[0] as string;
        return key.split(':').pop();
      });
      expect(types).toContain('tos');
      expect(types).toContain('privacy');
      expect(types).toContain('messaging');
    });
  });

  // ── Third-party consent ───────────────────────────

  describe('third-party consent', () => {
    it('returns false for unknown phone', async () => {
      mockRedisGet.mockResolvedValue(null);
      expect(await service.hasThirdPartyConsent('56900000000')).toBe(false);
    });

    it('returns true after recording contact', async () => {
      await service.recordThirdPartyContact('56900000000');
      expect(mockRedisSet).toHaveBeenCalledWith(
        'consent:3p:56900000000',
        expect.any(String),
        { EX: 180 * 24 * 60 * 60 },
      );
    });

    it('checks correct key for third-party', async () => {
      mockRedisGet.mockResolvedValue('2026-01-01');
      expect(await service.hasThirdPartyConsent('56900000000')).toBe(true);
      expect(mockRedisGet).toHaveBeenCalledWith('consent:3p:56900000000');
    });
  });
});
