/**
 * Unit tests for UserService.createUser.
 * Prisma is fully mocked — no DB or Redis connection required.
 */

jest.mock('../../src/config/environment', () => ({
  env: {
    NODE_ENV: 'test',
    ENCRYPTION_KEY_HEX: '0'.repeat(64),
  },
}));

// Build a reusable mock prisma object
const mockTx = {
  user: { findUnique: jest.fn(), create: jest.fn() },
  wallet: { create: jest.fn() },
};

const mockPrisma = {
  user: { findUnique: jest.fn(), update: jest.fn() },
  $transaction: jest.fn(),
};

jest.mock('../../src/config/database', () => ({
  prisma: mockPrisma,
}));

import { UserService } from '../../src/services/user.service';

// Valid Chilean RUT: body 76354771, DV = K (checksum verified)
const VALID_RUT = '76354771-K';
const VALID_PIN = '483920';

describe('UserService.createUser', () => {
  let svc: UserService;

  beforeEach(() => {
    svc = new UserService('0'.repeat(64));
    jest.clearAllMocks();

    // Default: $transaction executes the callback with mockTx
    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx),
    );

    // Default: no existing users
    mockTx.user.findUnique.mockResolvedValue(null);
    mockTx.user.create.mockResolvedValue({ id: 'uuid-123', kycLevel: 'BASIC' });
    mockTx.wallet.create.mockResolvedValue({});
  });

  describe('input validation (no DB calls)', () => {
    it('rejects invalid RUT', async () => {
      // '12345678-X': X is never a valid DV (only 0-9 and K are valid)
      const result = await svc.createUser({
        waId: '+56912345678',
        rut: '12345678-X',
        pin: VALID_PIN,
      });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/RUT/i);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects insecure PIN (all same digits)', async () => {
      const result = await svc.createUser({ waId: '+56912345678', rut: VALID_RUT, pin: '111111' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/PIN/i);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects sequential PIN (123456)', async () => {
      const result = await svc.createUser({ waId: '+56912345678', rut: VALID_RUT, pin: '123456' });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/PIN/i);
    });
  });

  describe('duplicate detection (inside transaction)', () => {
    it('returns error when phone already registered', async () => {
      // First findUnique (phone) returns existing user
      mockTx.user.findUnique.mockResolvedValueOnce({ id: 'existing', waId: '+56912345678' });

      const result = await svc.createUser({ waId: '+56912345678', rut: VALID_RUT, pin: VALID_PIN });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/número ya tiene/i);
      expect(mockTx.user.create).not.toHaveBeenCalled();
    });

    it('returns error when RUT already registered', async () => {
      // First findUnique (phone) returns null, second (RUT) returns existing user
      mockTx.user.findUnique
        .mockResolvedValueOnce(null) // phone check
        .mockResolvedValueOnce({ id: 'existing' }); // RUT check

      const result = await svc.createUser({ waId: '+56912345678', rut: VALID_RUT, pin: VALID_PIN });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/RUT ya está/i);
      expect(mockTx.user.create).not.toHaveBeenCalled();
    });

    it('handles P2002 (unique constraint race condition) gracefully', async () => {
      const p2002 = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      mockPrisma.$transaction.mockRejectedValue(p2002);

      const result = await svc.createUser({ waId: '+56912345678', rut: VALID_RUT, pin: VALID_PIN });
      expect(result.success).toBe(false);
      expect(result.error).toMatch(/ya está registrado/i);
    });

    it('rethrows unexpected errors', async () => {
      mockPrisma.$transaction.mockRejectedValue(new Error('DB connection lost'));

      await expect(
        svc.createUser({ waId: '+56912345678', rut: VALID_RUT, pin: VALID_PIN }),
      ).rejects.toThrow('DB connection lost');
    });
  });

  describe('successful registration', () => {
    it('creates user + wallet and returns userId', async () => {
      const result = await svc.createUser({
        waId: '+56912345678',
        rut: VALID_RUT,
        pin: VALID_PIN,
        name: 'Juan Pérez',
      });

      expect(result.success).toBe(true);
      expect(result.userId).toBe('uuid-123');
      expect(mockTx.user.create).toHaveBeenCalledTimes(1);
      expect(mockTx.wallet.create).toHaveBeenCalledTimes(1);
    });

    it('stores pinHash (not plain PIN) in DB', async () => {
      await svc.createUser({ waId: '+56912345678', rut: VALID_RUT, pin: VALID_PIN });

      const createCall = mockTx.user.create.mock.calls[0][0].data;
      // pinHash must NOT equal the plain PIN
      expect(createCall.pinHash).not.toBe(VALID_PIN);
      // pinHash must look like a bcrypt hash ($2b$...)
      expect(createCall.pinHash).toMatch(/^\$2[ab]\$/);
    });

    it('stores HMAC-hashed RUT (not plaintext) in rutHash field', async () => {
      await svc.createUser({ waId: '+56912345678', rut: VALID_RUT, pin: VALID_PIN });

      const createCall = mockTx.user.create.mock.calls[0][0].data;
      // rutHash must be hex, not the original RUT
      expect(createCall.rutHash).toMatch(/^[0-9a-f]{64}$/);
      expect(createCall.rutHash).not.toBe(VALID_RUT);
    });

    it('sets kycLevel BASIC on new user', async () => {
      await svc.createUser({ waId: '+56912345678', rut: VALID_RUT, pin: VALID_PIN });

      const createCall = mockTx.user.create.mock.calls[0][0].data;
      expect(createCall.kycLevel).toBe('BASIC');
    });
  });
});
