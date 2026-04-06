/**
 * Phone number utility tests — Chilean mobile numbers.
 */

import {
  normalizePhone, formatPhoneDisplay, formatPhoneWhatsApp,
  isValidChileanMobile, maskPhone, phoneKey,
} from '../../src/utils/phone';

describe('phone utilities', () => {
  // ── normalizePhone ────────────────────────────────

  describe('normalizePhone', () => {
    it('normalizes +56 format', () => {
      expect(normalizePhone('+56912345678')).toBe('56912345678');
    });

    it('normalizes 56 format', () => {
      expect(normalizePhone('56912345678')).toBe('56912345678');
    });

    it('normalizes 9-digit format', () => {
      expect(normalizePhone('912345678')).toBe('56912345678');
    });

    it('handles spaces and dashes', () => {
      expect(normalizePhone('+56 9 1234 5678')).toBe('56912345678');
      expect(normalizePhone('56-9-1234-5678')).toBe('56912345678');
    });

    it('handles leading 0', () => {
      expect(normalizePhone('09 1234 5678')).toBe('56912345678');
    });

    it('handles parentheses', () => {
      expect(normalizePhone('(+56) 912345678')).toBe('56912345678');
    });
  });

  // ── formatPhoneDisplay ────────────────────────────

  describe('formatPhoneDisplay', () => {
    it('formats as +56 9 1234 5678', () => {
      expect(formatPhoneDisplay('56912345678')).toBe('+56 9 1234 5678');
    });

    it('handles raw input', () => {
      expect(formatPhoneDisplay('+56912345678')).toBe('+56 9 1234 5678');
    });

    it('returns input unchanged for invalid numbers', () => {
      expect(formatPhoneDisplay('12345')).toBe('12345');
    });
  });

  // ── formatPhoneWhatsApp ───────────────────────────

  describe('formatPhoneWhatsApp', () => {
    it('returns 56XXXXXXXXX format', () => {
      expect(formatPhoneWhatsApp('+56 9 1234 5678')).toBe('56912345678');
    });
  });

  // ── isValidChileanMobile ──────────────────────────

  describe('isValidChileanMobile', () => {
    it('validates correct numbers', () => {
      expect(isValidChileanMobile('+56912345678')).toBe(true);
      expect(isValidChileanMobile('56912345678')).toBe(true);
      expect(isValidChileanMobile('912345678')).toBe(true);
    });

    it('rejects short numbers', () => {
      expect(isValidChileanMobile('12345')).toBe(false);
    });

    it('rejects non-mobile numbers', () => {
      expect(isValidChileanMobile('56212345678')).toBe(false); // landline
    });

    it('rejects non-Chilean numbers', () => {
      expect(isValidChileanMobile('+1234567890')).toBe(false);
    });
  });

  // ── maskPhone ─────────────────────────────────────

  describe('maskPhone', () => {
    it('masks middle digits', () => {
      expect(maskPhone('56912345678')).toBe('+56 9 **** 5678');
    });

    it('returns **** for invalid numbers', () => {
      expect(maskPhone('123')).toBe('****');
    });
  });

  // ── phoneKey ──────────────────────────────────────

  describe('phoneKey', () => {
    it('returns last 8 digits', () => {
      expect(phoneKey('56912345678')).toBe('12345678');
    });

    it('works from various formats', () => {
      expect(phoneKey('+56912345678')).toBe('12345678');
      expect(phoneKey('912345678')).toBe('12345678');
    });
  });
});
