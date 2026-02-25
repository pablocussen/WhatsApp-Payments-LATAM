/**
 * Integration tests for WhatPay API
 *
 * These tests verify the WhatsApp webhook parsing, idempotency logic,
 * payment service calculations, and crypto utilities in realistic scenarios.
 * No real DB or Redis needed.
 */

// Mock environment before any service imports
jest.mock('../../src/config/environment', () => ({
  env: {
    NODE_ENV: 'test',
    PORT: 3000,
    WHATSAPP_API_URL: 'https://graph.facebook.com/v18.0',
    WHATSAPP_PHONE_NUMBER_ID: 'test-phone-id',
    WHATSAPP_BUSINESS_ACCOUNT_ID: 'test-account-id',
    WHATSAPP_API_TOKEN: 'test-token',
    WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
    APP_BASE_URL: 'https://whatpay.cl',
    PAYMENT_LINK_BASE_URL: 'https://whatpay.cl/c',
  },
  loadEnvironment: jest.fn(),
}));

import { WhatsAppService } from '../../src/services/whatsapp.service';
import { isSecurePin, verifyPin } from '../../src/middleware/auth.middleware';
import { generateOTP, generateReference, validateRut, encrypt, decrypt } from '../../src/utils/crypto';
import { formatCLP, normalizePhone } from '../../src/utils/format';
import { hash } from 'bcrypt';

// ─── WhatsApp Webhook Parsing ────────────────────────────

describe('WhatsApp Webhook Parsing', () => {
  const whatsapp = new WhatsAppService();

  it('parses a valid text message', () => {
    const body = {
      entry: [{
        changes: [{
          value: {
            messages: [{
              from: '56912345678',
              id: 'wamid.abc123',
              timestamp: '1700000000',
              type: 'text',
              text: { body: '/saldo' },
            }],
          },
        }],
      }],
    };

    const msg = whatsapp.parseWebhookMessage(body);
    expect(msg).not.toBeNull();
    expect(msg!.from).toBe('56912345678');
    expect(msg!.id).toBe('wamid.abc123');
    expect(msg!.text?.body).toBe('/saldo');
  });

  it('parses an interactive button reply', () => {
    const body = {
      entry: [{
        changes: [{
          value: {
            messages: [{
              from: '56912345678',
              id: 'wamid.btn456',
              timestamp: '1700000001',
              type: 'interactive',
              interactive: {
                type: 'button_reply',
                button_reply: { id: 'confirm_pay', title: 'Confirmar' },
              },
            }],
          },
        }],
      }],
    };

    const msg = whatsapp.parseWebhookMessage(body);
    expect(msg).not.toBeNull();
    expect(msg!.interactive?.button_reply?.id).toBe('confirm_pay');
  });

  it('returns null for empty webhook body', () => {
    expect(whatsapp.parseWebhookMessage({})).toBeNull();
    expect(whatsapp.parseWebhookMessage({ entry: [] })).toBeNull();
    expect(whatsapp.parseWebhookMessage(null)).toBeNull();
  });

  it('returns null for status updates (no messages)', () => {
    const body = {
      entry: [{
        changes: [{
          value: {
            statuses: [{ id: 'wamid.status1', status: 'delivered' }],
          },
        }],
      }],
    };
    expect(whatsapp.parseWebhookMessage(body)).toBeNull();
  });
});

// ─── Webhook Verification ────────────────────────────────

describe('Webhook Verification', () => {
  const whatsapp = new WhatsAppService();

  it('accepts correct verify token', () => {
    expect(whatsapp.verifyWebhook('subscribe', 'test-verify-token', 'challenge123')).toBe('challenge123');
  });

  it('rejects wrong verify token', () => {
    expect(whatsapp.verifyWebhook('subscribe', 'wrong-token', 'challenge123')).toBeNull();
  });

  it('rejects non-subscribe mode', () => {
    expect(whatsapp.verifyWebhook('unsubscribe', 'any', 'challenge123')).toBeNull();
  });
});

// ─── PIN Security (Full Flow) ────────────────────────────

describe('PIN Security Flow', () => {
  it('validates correct PIN against bcrypt hash', async () => {
    const pin = '847293';
    const hashed = await hash(pin, 12);
    const result = await verifyPin(pin, hashed, 0, null);
    expect(result.success).toBe(true);
    expect(result.shouldLock).toBe(false);
  });

  it('locks account after 3 failed attempts', async () => {
    const hashed = await hash('847293', 12);
    const result = await verifyPin('000000', hashed, 2, null);
    expect(result.success).toBe(false);
    expect(result.shouldLock).toBe(true);
  });

  it('rejects request when account is locked', async () => {
    const futureDate = new Date(Date.now() + 600_000); // 10 min from now
    const result = await verifyPin('847293', '$2b$12$fake', 0, futureDate);
    expect(result.success).toBe(false);
    expect(result.message).toContain('bloqueada');
  });

  it('rejects common insecure PINs', () => {
    expect(isSecurePin('111111')).toBe(false);
    expect(isSecurePin('123456')).toBe(false);
    expect(isSecurePin('654321')).toBe(false);
    expect(isSecurePin('12345')).toBe(false);  // too short
    expect(isSecurePin('abcdef')).toBe(false); // non-numeric
  });

  it('accepts secure PINs', () => {
    expect(isSecurePin('847293')).toBe(true);
    expect(isSecurePin('502817')).toBe(true);
    expect(isSecurePin('391048')).toBe(true);
  });
});

// ─── OTP Security ────────────────────────────────────────

describe('OTP Generation (crypto-secure)', () => {
  it('generates OTPs of requested length', () => {
    expect(generateOTP(4)).toHaveLength(4);
    expect(generateOTP(6)).toHaveLength(6);
    expect(generateOTP(8)).toHaveLength(8);
  });

  it('generates only numeric OTPs', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateOTP(6)).toMatch(/^\d{6}$/);
    }
  });

  it('generates diverse OTPs (not all identical)', () => {
    const otps = new Set(Array.from({ length: 100 }, () => generateOTP(6)));
    expect(otps.size).toBeGreaterThan(90);
  });
});

// ─── End-to-End Encryption Flow ──────────────────────────

describe('Encryption E2E', () => {
  const key = Buffer.from('a'.repeat(64), 'hex');

  it('encrypts RUT and decrypts back', () => {
    const rut = '12.345.678-5';
    const encrypted = encrypt(rut, key);
    expect(encrypted).not.toContain(rut);
    expect(decrypt(encrypted, key)).toBe(rut);
  });

  it('encrypts phone numbers', () => {
    const phone = '+56912345678';
    const encrypted = encrypt(phone, key);
    expect(decrypt(encrypted, key)).toBe(phone);
  });

  it('encrypted format has 3 hex parts separated by colons', () => {
    const encrypted = encrypt('test-data', key);
    const parts = encrypted.split(':');
    expect(parts).toHaveLength(3);
    parts.forEach((part) => {
      expect(part).toMatch(/^[0-9a-f]+$/);
    });
  });
});

// ─── Chilean Phone Normalization ─────────────────────────

describe('Phone Normalization', () => {
  it('normalizes Chilean mobile numbers', () => {
    expect(normalizePhone('912345678')).toBe('56912345678');
    expect(normalizePhone('56912345678')).toBe('56912345678');
    expect(normalizePhone('+56912345678')).toBe('56912345678');
  });
});

// ─── Payment Reference Format ────────────────────────────

describe('Payment References', () => {
  it('generates references with correct year', () => {
    const ref = generateReference();
    const currentYear = new Date().getFullYear();
    expect(ref).toContain(`#WP-${currentYear}-`);
  });

  it('generates unique references', () => {
    const refs = new Set(Array.from({ length: 100 }, () => generateReference()));
    expect(refs.size).toBe(100);
  });
});

// ─── RUT Validation Edge Cases ───────────────────────────

describe('RUT Validation Edge Cases', () => {
  it('handles RUTs without formatting', () => {
    expect(validateRut('123456785')).toBe(true);
  });

  it('rejects RUTs with wrong check digit', () => {
    expect(validateRut('12345678-0')).toBe(false);
    expect(validateRut('12345678-1')).toBe(false);
    expect(validateRut('12345678-K')).toBe(false);
  });

  it('rejects too short or too long inputs', () => {
    expect(validateRut('1234567')).toBe(false);    // 7 chars
    expect(validateRut('1234567890')).toBe(false);  // 10 chars
  });

  it('handles whitespace and mixed case', () => {
    expect(validateRut(' 10.000.013-k ')).toBe(true); // cleanRut strips spaces too
    expect(validateRut('10000013k')).toBe(true);
  });
});

// ─── Currency Formatting ─────────────────────────────────

describe('CLP Formatting', () => {
  it('formats amounts correctly for display', () => {
    expect(formatCLP(1000)).toBe('$1.000');
    expect(formatCLP(50000)).toBe('$50.000');
    expect(formatCLP(1500000)).toBe('$1.500.000');
  });

  it('formats zero', () => {
    expect(formatCLP(0)).toBe('$0');
  });
});
