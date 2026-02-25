import { isSecurePin } from '../../src/middleware/auth.middleware';

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
