import {
  encrypt,
  decrypt,
  hmacHash,
  hashPin,
  verifyPinHash,
  validateRut,
  cleanRut,
  formatRut,
  generateShortCode,
  generateReference,
  generateOTP,
} from '../../src/utils/crypto';

const TEST_KEY = Buffer.from('0'.repeat(64), 'hex'); // 32 bytes

describe('AES-256-GCM Encryption', () => {
  it('encrypts and decrypts correctly', () => {
    const plaintext = '12345678-9';
    const encrypted = encrypt(plaintext, TEST_KEY);
    const decrypted = decrypt(encrypted, TEST_KEY);
    expect(decrypted).toBe(plaintext);
  });

  it('produces different ciphertext each time (random IV)', () => {
    const plaintext = 'same-data';
    const a = encrypt(plaintext, TEST_KEY);
    const b = encrypt(plaintext, TEST_KEY);
    expect(a).not.toBe(b);
  });

  it('fails to decrypt with wrong key', () => {
    const encrypted = encrypt('secret', TEST_KEY);
    const wrongKey = Buffer.from('1'.repeat(64), 'hex');
    expect(() => decrypt(encrypted, wrongKey)).toThrow();
  });
});

describe('HMAC Hash', () => {
  it('produces consistent hashes', () => {
    const a = hmacHash('12345678K', TEST_KEY);
    const b = hmacHash('12345678K', TEST_KEY);
    expect(a).toBe(b);
  });

  it('produces different hashes for different inputs', () => {
    const a = hmacHash('12345678K', TEST_KEY);
    const b = hmacHash('87654321K', TEST_KEY);
    expect(a).not.toBe(b);
  });
});

describe('PIN Hashing (bcrypt)', () => {
  it('hashes and verifies a PIN', async () => {
    const pin = '483921';
    const hashed = await hashPin(pin);
    expect(hashed).not.toBe(pin);
    expect(await verifyPinHash(pin, hashed)).toBe(true);
  });

  it('rejects wrong PIN', async () => {
    const hashed = await hashPin('483921');
    expect(await verifyPinHash('999999', hashed)).toBe(false);
  });
});

describe('RUT Validation', () => {
  it('validates correct RUTs', () => {
    expect(validateRut('12.345.678-5')).toBe(true);
    expect(validateRut('11111111-1')).toBe(true);
    expect(validateRut('76086428-5')).toBe(true);
    expect(validateRut('5.126.663-3')).toBe(true);
  });

  it('rejects invalid RUTs', () => {
    expect(validateRut('12.345.678-0')).toBe(false);
    expect(validateRut('00000000-0')).toBe(false);
    expect(validateRut('abc')).toBe(false);
    expect(validateRut('')).toBe(false);
  });

  it('handles RUT with K check digit', () => {
    expect(validateRut('10.000.013-K')).toBe(true);
    expect(validateRut('10000013k')).toBe(true);
  });
});

describe('RUT Formatting', () => {
  it('cleans RUT', () => {
    expect(cleanRut('12.345.678-5')).toBe('123456785');
    expect(cleanRut('12345678-5')).toBe('123456785');
    expect(cleanRut('12345678k')).toBe('12345678K');
  });

  it('formats RUT', () => {
    expect(formatRut('123456785')).toBe('12.345.678-5');
    expect(formatRut('12.345.678-5')).toBe('12.345.678-5');
  });
});

describe('Code Generation', () => {
  it('generates short codes of correct length', () => {
    expect(generateShortCode(6)).toHaveLength(6);
    expect(generateShortCode(8)).toHaveLength(8);
  });

  it('generates unique short codes', () => {
    const codes = new Set(Array.from({ length: 100 }, () => generateShortCode()));
    expect(codes.size).toBe(100);
  });

  it('generates references in correct format', () => {
    const ref = generateReference();
    expect(ref).toMatch(/^#WP-\d{4}-[A-F0-9]{8}$/);
  });

  it('generates OTPs of correct length', () => {
    expect(generateOTP(6)).toHaveLength(6);
    expect(generateOTP(4)).toHaveLength(4);
  });
});
