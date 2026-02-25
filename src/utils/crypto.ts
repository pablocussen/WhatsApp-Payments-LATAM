import { randomBytes, randomInt, createCipheriv, createDecipheriv, createHmac } from 'crypto';
import { hash, compare } from 'bcrypt';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const BCRYPT_ROUNDS = 12;

// ─── AES-256-GCM Encryption ────────────────────────────

export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:ciphertext (all hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decrypt(ciphertext: string, key: Buffer): string {
  const [ivHex, authTagHex, encrypted] = ciphertext.split(':');

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

// ─── HMAC (for searchable encrypted fields) ─────────────

export function hmacHash(data: string, key: Buffer): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

// ─── PIN Hashing (bcrypt) ───────────────────────────────

export async function hashPin(pin: string): Promise<string> {
  return hash(pin, BCRYPT_ROUNDS);
}

export async function verifyPinHash(pin: string, storedHash: string): Promise<boolean> {
  return compare(pin, storedHash);
}

// ─── RUT Utilities ──────────────────────────────────────

export function cleanRut(rut: string): string {
  return rut.replace(/[.\-\s]/g, '').toUpperCase();
}

export function validateRut(rut: string): boolean {
  const cleaned = cleanRut(rut);
  if (cleaned.length < 8 || cleaned.length > 9) return false;

  const body = cleaned.slice(0, -1);
  const checkDigit = cleaned.slice(-1);

  // Reject all-zero bodies
  if (/^0+$/.test(body)) return false;

  let sum = 0;
  let multiplier = 2;

  for (let i = body.length - 1; i >= 0; i--) {
    sum += parseInt(body[i], 10) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }

  const remainder = 11 - (sum % 11);
  const expected = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);

  return checkDigit === expected;
}

export function formatRut(rut: string): string {
  const cleaned = cleanRut(rut);
  const body = cleaned.slice(0, -1);
  const dv = cleaned.slice(-1);
  const formatted = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${formatted}-${dv}`;
}

// ─── Random Codes ───────────────────────────────────────

export function generateShortCode(length = 6): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  const bytes = randomBytes(length);
  for (let i = 0; i < length; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}

export function generateReference(): string {
  const year = new Date().getFullYear();
  const hex = randomBytes(4).toString('hex').toUpperCase();
  return `#WP-${year}-${hex}`;
}

export function generateOTP(length = 6): string {
  const max = Math.pow(10, length);
  const num = randomInt(0, max);
  return String(num).padStart(length, '0');
}
