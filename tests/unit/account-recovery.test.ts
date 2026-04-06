/**
 * AccountRecoveryService — PIN recovery with verification codes.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockAuditLog = jest.fn();

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../src/services/audit.service', () => ({
  audit: { log: (...args: unknown[]) => mockAuditLog(...args) },
}));

import { AccountRecoveryService } from '../../src/services/account-recovery.service';

describe('AccountRecoveryService', () => {
  let service: AccountRecoveryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AccountRecoveryService();
    mockRedisGet.mockResolvedValue(null);
  });

  // ── initiateRecovery ──────────────────────────────

  describe('initiateRecovery', () => {
    it('generates a 6-digit code', async () => {
      const result = await service.initiateRecovery('user-1', '56912345678');
      expect(result.code).toMatch(/^\d{6}$/);
      expect(result.requestId).toMatch(/^rec_/);
      expect(result.expiresInMinutes).toBe(15);
    });

    it('stores request in Redis with TTL', async () => {
      await service.initiateRecovery('user-1', '56912345678');
      expect(mockRedisSet).toHaveBeenCalledWith(
        'recovery:user-1',
        expect.any(String),
        { EX: 900 },
      );
    });

    it('logs audit event', async () => {
      await service.initiateRecovery('user-1', '56912345678');
      expect(mockAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ action: 'recovery_initiated' }) }),
      );
    });

    it('rejects if active request exists', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ used: false }));
      await expect(service.initiateRecovery('user-1', '56912345678'))
        .rejects.toThrow('activa');
    });

    it('allows new request if previous was used', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({ used: true }));
      const result = await service.initiateRecovery('user-1', '56912345678');
      expect(result.code).toMatch(/^\d{6}$/);
    });
  });

  // ── verifyCode ────────────────────────────────────

  describe('verifyCode', () => {
    const futureDate = new Date(Date.now() + 600_000).toISOString();

    it('accepts correct code', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({
        code: '123456', attempts: 0, used: false, expiresAt: futureDate,
        id: 'rec_test',
      }));

      const result = await service.verifyCode('user-1', '123456');
      expect(result.valid).toBe(true);
      expect(result.message).toContain('verificado');
    });

    it('rejects incorrect code and decrements attempts', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({
        code: '123456', attempts: 0, used: false, expiresAt: futureDate,
      }));

      const result = await service.verifyCode('user-1', '999999');
      expect(result.valid).toBe(false);
      expect(result.remainingAttempts).toBe(2);
    });

    it('rejects after max attempts', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({
        code: '123456', attempts: 3, used: false, expiresAt: futureDate,
      }));

      const result = await service.verifyCode('user-1', '123456');
      expect(result.valid).toBe(false);
      expect(result.message).toContain('intentos');
    });

    it('rejects expired code', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({
        code: '123456', attempts: 0, used: false,
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      }));

      const result = await service.verifyCode('user-1', '123456');
      expect(result.valid).toBe(false);
      expect(result.message).toContain('expirado');
    });

    it('rejects already used code', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({
        code: '123456', attempts: 0, used: true, expiresAt: futureDate,
      }));

      const result = await service.verifyCode('user-1', '123456');
      expect(result.valid).toBe(false);
      expect(result.message).toContain('usado');
    });

    it('returns error when no active request', async () => {
      mockRedisGet.mockResolvedValue(null);
      const result = await service.verifyCode('user-1', '123456');
      expect(result.valid).toBe(false);
      expect(result.message).toContain('No hay');
    });

    it('marks code as used after verification', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify({
        code: '123456', attempts: 0, used: false, expiresAt: futureDate,
        id: 'rec_test',
      }));

      await service.verifyCode('user-1', '123456');

      const stored = JSON.parse(mockRedisSet.mock.calls[0][1]);
      expect(stored.used).toBe(true);
    });
  });
});
