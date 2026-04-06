/**
 * Chilean phone number utilities.
 * Handles normalization, formatting, and validation.
 */

const CHILE_CODE = '56';
const MOBILE_PREFIX = '9';
const EXPECTED_LENGTH = 11; // 56 + 9 digits

/**
 * Normalize a phone number to format: 56XXXXXXXXX (11 digits, no +).
 * Handles: +56912345678, 56912345678, 912345678, 09 1234 5678, etc.
 */
export function normalizePhone(input: string): string {
  // Remove everything that's not a digit
  let digits = input.replace(/\D/g, '');

  // Remove leading 0 (Chilean local format)
  if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }

  // Add country code if missing
  if (digits.length === 9 && digits.startsWith(MOBILE_PREFIX)) {
    digits = CHILE_CODE + digits;
  }

  return digits;
}

/**
 * Format for display: +56 9 1234 5678
 */
export function formatPhoneDisplay(input: string): string {
  const n = normalizePhone(input);
  if (n.length !== EXPECTED_LENGTH) return input;
  return `+${n.slice(0, 2)} ${n.slice(2, 3)} ${n.slice(3, 7)} ${n.slice(7)}`;
}

/**
 * Format for WhatsApp API: 56912345678 (no +)
 */
export function formatPhoneWhatsApp(input: string): string {
  return normalizePhone(input);
}

/**
 * Validate a Chilean mobile number.
 */
export function isValidChileanMobile(input: string): boolean {
  const n = normalizePhone(input);
  return n.length === EXPECTED_LENGTH && n.startsWith(CHILE_CODE + MOBILE_PREFIX);
}

/**
 * Mask a phone number for privacy: +56 9 **** 5678
 */
export function maskPhone(input: string): string {
  const n = normalizePhone(input);
  if (n.length !== EXPECTED_LENGTH) return '****';
  return `+${n.slice(0, 2)} ${n.slice(2, 3)} **** ${n.slice(7)}`;
}

/**
 * Extract the carrier-agnostic part (last 8 digits) for matching.
 */
export function phoneKey(input: string): string {
  const n = normalizePhone(input);
  return n.slice(-8);
}
