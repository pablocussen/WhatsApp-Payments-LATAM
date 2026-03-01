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
  user: { findUnique: jest.fn(), update: jest.fn(), count: jest.fn() },
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

// ─── verifyUserPin ───────────────────────────────────────

describe('UserService.verifyUserPin', () => {
  let svc: UserService;

  beforeEach(() => {
    svc = new UserService('0'.repeat(64));
    jest.clearAllMocks();
    mockPrisma.user.update.mockResolvedValue({});
  });

  it('returns failure when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const result = await svc.verifyUserPin('+56912345678', VALID_PIN);
    expect(result.success).toBe(false);
    expect(result.isLocked).toBeUndefined();
  });

  it('returns isLocked=true when account is currently locked', async () => {
    const lockedUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 min in future
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'uid-1',
      pinHash: '$2b$12$fakehash',
      pinAttempts: 0,
      lockedUntil,
    });

    const result = await svc.verifyUserPin('+56912345678', VALID_PIN);

    expect(result.success).toBe(false);
    expect(result.isLocked).toBe(true);
    expect(result.message).toMatch(/bloqueada/i);
  });

  it('returns success=true and resets attempts on correct PIN', async () => {
    // Hash the valid PIN so verifyPinHash succeeds
    const { hashPin } = await import('../../src/utils/crypto');
    const hash = await hashPin(VALID_PIN);

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'uid-1',
      pinHash: hash,
      pinAttempts: 1, // some previous failures
      lockedUntil: null,
    });

    const result = await svc.verifyUserPin('+56912345678', VALID_PIN);

    expect(result.success).toBe(true);
    // Should reset attempts to 0
    const updateArgs = mockPrisma.user.update.mock.calls[0][0].data;
    expect(updateArgs.pinAttempts).toBe(0);
    expect(updateArgs.lockedUntil).toBeNull();
  });

  it('increments attempt count on wrong PIN (1st attempt)', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'uid-1',
      pinHash: '$2b$12$intentionally_wrong_hash',
      pinAttempts: 0,
      lockedUntil: null,
    });

    const result = await svc.verifyUserPin('+56912345678', 'wrongpin');

    expect(result.success).toBe(false);
    expect(result.isLocked).toBeUndefined(); // not locked yet
    expect(result.message).toMatch(/2 intentos/i);
    const updateArgs = mockPrisma.user.update.mock.calls[0][0].data;
    expect(updateArgs.pinAttempts).toBe(1);
  });

  it('locks account and returns isLocked=true after 3rd failed attempt', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'uid-1',
      pinHash: '$2b$12$intentionally_wrong_hash',
      pinAttempts: 2, // 2 failures already
      lockedUntil: null,
    });

    const result = await svc.verifyUserPin('+56912345678', 'wrongpin');

    expect(result.success).toBe(false);
    expect(result.isLocked).toBe(true);
    expect(result.message).toMatch(/bloqueada/i);
    // On lock: pinAttempts resets to 0, lockedUntil is set
    const updateArgs = mockPrisma.user.update.mock.calls[0][0].data;
    expect(updateArgs.pinAttempts).toBe(0);
    expect(updateArgs.lockedUntil).toBeInstanceOf(Date);
  });
});

// ─── getUserByWaId / getUserById ─────────────────────────

describe('UserService.getUserByWaId / getUserById', () => {
  let svc: UserService;

  beforeEach(() => {
    svc = new UserService('0'.repeat(64));
    jest.clearAllMocks();
  });

  const profileFields = {
    id: 'uid-001',
    waId: '+56912345678',
    name: 'Juan',
    kycLevel: 'BASIC',
    biometricEnabled: false,
    createdAt: new Date(),
  };

  it('getUserByWaId: returns null for unknown waId', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const result = await svc.getUserByWaId('+56900000000');
    expect(result).toBeNull();
  });

  it('getUserByWaId: returns user profile for known waId', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(profileFields);
    const result = await svc.getUserByWaId('+56912345678');
    expect(result?.id).toBe('uid-001');
    expect(result?.name).toBe('Juan');
    expect(result?.kycLevel).toBe('BASIC');
  });

  it('getUserById: returns null for unknown id', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const result = await svc.getUserById('no-such-id');
    expect(result).toBeNull();
  });

  it('getUserById: returns user profile for known id', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      ...profileFields,
      kycLevel: 'INTERMEDIATE',
      biometricEnabled: true,
    });
    const result = await svc.getUserById('uid-001');
    expect(result?.kycLevel).toBe('INTERMEDIATE');
    expect(result?.biometricEnabled).toBe(true);
  });
});

// ─── setNewPin ───────────────────────────────────────────

describe('UserService.setNewPin', () => {
  let svc: UserService;

  beforeEach(() => {
    svc = new UserService('0'.repeat(64));
    jest.clearAllMocks();
    mockPrisma.user.update.mockResolvedValue({});
  });

  it('throws on insecure PIN (all same digits)', async () => {
    await expect(svc.setNewPin('+56912345678', '111111')).rejects.toThrow('inseguro');
  });

  it('throws on sequential PIN', async () => {
    await expect(svc.setNewPin('+56912345678', '123456')).rejects.toThrow('inseguro');
  });

  it('updates user with bcrypt hash, resets attempts and lockedUntil', async () => {
    await svc.setNewPin('+56912345678', '483920');

    const updateArgs = mockPrisma.user.update.mock.calls[0][0].data;
    expect(updateArgs.pinHash).toMatch(/^\$2[ab]\$/);
    expect(updateArgs.pinAttempts).toBe(0);
    expect(updateArgs.lockedUntil).toBeNull();
  });
});

// ─── changePin ───────────────────────────────────────────

describe('UserService.changePin', () => {
  let svc: UserService;

  beforeEach(() => {
    svc = new UserService('0'.repeat(64));
    jest.clearAllMocks();
    mockPrisma.user.update.mockResolvedValue({});
  });

  it('returns failure when current PIN is wrong', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'uid-1',
      pinHash: '$2b$12$intentionally_wrong',
      pinAttempts: 0,
      lockedUntil: null,
    });

    const result = await svc.changePin('+56912345678', 'wrongpin', '483920');
    expect(result.success).toBe(false);
  });

  it('returns failure when new PIN is insecure', async () => {
    // Use real hash so verifyUserPin succeeds
    const { hashPin } = await import('../../src/utils/crypto');
    const hash = await hashPin(VALID_PIN);

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'uid-1',
      pinHash: hash,
      pinAttempts: 0,
      lockedUntil: null,
    });

    const result = await svc.changePin('+56912345678', VALID_PIN, '123456');
    expect(result.success).toBe(false);
    expect(result.message).toMatch(/inseguro/i);
  });

  it('updates PIN hash on success', async () => {
    const { hashPin } = await import('../../src/utils/crypto');
    const hash = await hashPin(VALID_PIN);

    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'uid-1',
      pinHash: hash,
      pinAttempts: 0,
      lockedUntil: null,
    });

    const result = await svc.changePin('+56912345678', VALID_PIN, '738291');
    expect(result.success).toBe(true);
    // New hash should be bcrypt
    const updateArgs = mockPrisma.user.update.mock.calls[1][0].data; // 2nd update call
    expect(updateArgs.pinHash).toMatch(/^\$2[ab]\$/);
  });
});

// ─── updateKycLevel ──────────────────────────────────────

describe('UserService.updateKycLevel', () => {
  let svc: UserService;

  beforeEach(() => {
    svc = new UserService('0'.repeat(64));
    jest.clearAllMocks();
    mockPrisma.user.update.mockResolvedValue({});
  });

  it('updates kycLevel via Prisma', async () => {
    await svc.updateKycLevel('uid-001', 'INTERMEDIATE');

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'uid-001' },
      data: { kycLevel: 'INTERMEDIATE' },
    });
  });
});

// ─── getUserCount ────────────────────────────────────────

describe('UserService.getUserCount', () => {
  let svc: UserService;

  beforeEach(() => {
    svc = new UserService('0'.repeat(64));
    jest.clearAllMocks();
  });

  it('returns count of active users', async () => {
    mockPrisma.user.count.mockResolvedValue(42);

    const result = await svc.getUserCount();

    expect(result).toBe(42);
    expect(mockPrisma.user.count).toHaveBeenCalledWith({ where: { isActive: true } });
  });
});

// ─── constructor key fallback ─────────────────────────────

describe('UserService constructor', () => {
  it('uses env fallback when no encryption key argument is provided', () => {
    // Covers the `encryptionKeyHex || process.env.ENCRYPTION_KEY_HEX || '0'.repeat(64)` branch
    const svcNoKey = new UserService();
    expect(svcNoKey).toBeDefined();
  });
});
