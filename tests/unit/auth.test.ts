import { isSecurePin, verifyPin } from '../../src/middleware/auth.middleware';
import { hashPin } from '../../src/utils/crypto';

describe('PIN Security Validation', () => {
  describe('rejects insecure PINs', () => {
    it('rejects PINs shorter than 6 digits', () => {
      expect(isSecurePin('12345')).toBe(false);
      expect(isSecurePin('1234')).toBe(false);
      expect(isSecurePin('')).toBe(false);
    });

    it('rejects PINs longer than 6 digits', () => {
      expect(isSecurePin('1234567')).toBe(false);
    });

    it('rejects non-numeric PINs', () => {
      expect(isSecurePin('abcdef')).toBe(false);
      expect(isSecurePin('12345a')).toBe(false);
      expect(isSecurePin('12 345')).toBe(false);
    });

    it('rejects all-same-digit PINs', () => {
      expect(isSecurePin('111111')).toBe(false);
      expect(isSecurePin('000000')).toBe(false);
      expect(isSecurePin('999999')).toBe(false);
      expect(isSecurePin('555555')).toBe(false);
    });

    it('rejects ascending sequential PINs', () => {
      expect(isSecurePin('012345')).toBe(false);
      expect(isSecurePin('123456')).toBe(false);
      expect(isSecurePin('234567')).toBe(false);
      expect(isSecurePin('345678')).toBe(false);
      expect(isSecurePin('456789')).toBe(false);
    });

    it('rejects descending sequential PINs', () => {
      expect(isSecurePin('987654')).toBe(false);
      expect(isSecurePin('876543')).toBe(false);
      expect(isSecurePin('765432')).toBe(false);
      expect(isSecurePin('654321')).toBe(false);
      expect(isSecurePin('543210')).toBe(false);
    });
  });

  describe('accepts secure PINs', () => {
    it('accepts random 6-digit PINs', () => {
      expect(isSecurePin('483921')).toBe(true);
      expect(isSecurePin('719203')).toBe(true);
      expect(isSecurePin('260847')).toBe(true);
      expect(isSecurePin('902174')).toBe(true);
    });

    it('accepts PINs with some repeated digits', () => {
      expect(isSecurePin('112233')).toBe(true);
      expect(isSecurePin('998877')).toBe(true);
    });

    it('accepts PINs with partial sequences', () => {
      expect(isSecurePin('123789')).toBe(true);
      expect(isSecurePin('456123')).toBe(true);
    });
  });
});

describe('verifyPin', () => {
  let validHash: string;

  beforeAll(async () => {
    validHash = await hashPin('483921');
  });

  it('returns success=true for correct PIN', async () => {
    const result = await verifyPin('483921', validHash, 0, null);
    expect(result.success).toBe(true);
    expect(result.shouldLock).toBe(false);
  });

  it('returns shouldLock=false and remaining attempts message for wrong PIN (not at limit)', async () => {
    const result = await verifyPin('000000', validHash, 0, null); // 0 previous attempts
    expect(result.success).toBe(false);
    expect(result.shouldLock).toBe(false);
    expect(result.message).toMatch(/2 intentos/);
  });

  it('returns shouldLock=true when attempts reach limit (3rd failure)', async () => {
    const result = await verifyPin('000000', validHash, 2, null); // 2 previous → 3rd failure
    expect(result.success).toBe(false);
    expect(result.shouldLock).toBe(true);
    expect(result.message).toMatch(/bloqueada/i);
  });

  it('returns locked message when lockedUntil is in the future', async () => {
    const future = new Date(Date.now() + 10 * 60 * 1000);
    const result = await verifyPin('483921', validHash, 0, future);
    expect(result.success).toBe(false);
    expect(result.shouldLock).toBe(false);
    expect(result.message).toMatch(/minutos/i);
  });
});
