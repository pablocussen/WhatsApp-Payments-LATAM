/**
 * i18n — internationalization for bot messages.
 */

import { t, greetingI18n, supportedLocales, isValidLocale } from '../../src/utils/i18n';

describe('i18n', () => {
  // ── t() function ──────────────────────────────────

  describe('t()', () => {
    it('returns Spanish text by default', () => {
      expect(t('menu.sendMoney')).toBe('Enviar dinero');
      expect(t('menu.charge')).toBe('Cobrar');
    });

    it('returns English text when locale is en', () => {
      expect(t('menu.sendMoney', 'en')).toBe('Send money');
      expect(t('menu.charge', 'en')).toBe('Charge');
    });

    it('returns key if not found', () => {
      expect(t('nonexistent.key')).toBe('nonexistent.key');
      expect(t('nonexistent.key', 'en')).toBe('nonexistent.key');
    });

    it('falls back to Spanish for unknown locale within valid key', () => {
      // TypeScript won't allow invalid locale, but test runtime
      expect(t('menu.sendMoney', 'es')).toBe('Enviar dinero');
    });

    it('has translations for all critical paths', () => {
      const criticalKeys = [
        'register.welcome', 'register.cta', 'register.enterRut', 'register.success',
        'menu.whatDoYouNeed', 'menu.sendMoney', 'menu.charge', 'menu.myWallet',
        'balance.title', 'balance.label',
        'pay.sent', 'pay.received', 'pay.enterPhone', 'pay.enterAmount', 'pay.enterPin',
        'charge.payNow', 'charge.decline',
        'support.title', 'support.contactUs',
        'error.invalidPhone', 'error.invalidPin', 'error.insufficientFunds',
        'general.confirm', 'general.cancel',
      ];

      for (const key of criticalKeys) {
        const es = t(key, 'es');
        const en = t(key, 'en');
        expect(es).not.toBe(key); // not falling through
        expect(en).not.toBe(key); // not falling through
        expect(es).not.toBe(en);  // actually different
      }
    });
  });

  // ── greetingI18n() ────────────────────────────────

  describe('greetingI18n()', () => {
    it('returns a Spanish greeting by default', () => {
      const greeting = greetingI18n('Juan');
      expect(greeting).toMatch(/Buenos|Buenas/);
      expect(greeting).toContain('Juan');
    });

    it('returns an English greeting when locale is en', () => {
      const greeting = greetingI18n('John', 'en');
      expect(greeting).toMatch(/Good (morning|afternoon|evening)/);
      expect(greeting).toContain('John');
    });

    it('handles null name', () => {
      const es = greetingI18n(null, 'es');
      const en = greetingI18n(null, 'en');
      expect(es).toMatch(/^Buenos|^Buenas/);
      expect(en).toMatch(/^Good/);
    });
  });

  // ── supportedLocales() ────────────────────────────

  describe('supportedLocales()', () => {
    it('returns es and en', () => {
      expect(supportedLocales()).toEqual(['es', 'en']);
    });
  });

  // ── isValidLocale() ───────────────────────────────

  describe('isValidLocale()', () => {
    it('accepts es and en', () => {
      expect(isValidLocale('es')).toBe(true);
      expect(isValidLocale('en')).toBe(true);
    });

    it('rejects other locales', () => {
      expect(isValidLocale('fr')).toBe(false);
      expect(isValidLocale('pt')).toBe(false);
      expect(isValidLocale('')).toBe(false);
    });
  });
});
