import { createHmac } from 'crypto';

// We test the signature logic directly to avoid needing a full Express app
function verifySignature(
  body: unknown,
  signatureHeader: string | undefined,
  appSecret: string | undefined,
): boolean {
  if (!appSecret) return true; // dev mode — skip validation

  if (!signatureHeader) return false;

  const expected = `sha256=${createHmac('sha256', appSecret)
    .update(JSON.stringify(body))
    .digest('hex')}`;

  // timing-safe comparison
  try {
    const { timingSafeEqual } = require('crypto');
    return timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

describe('WhatsApp webhook signature validation', () => {
  const SECRET = 'test-app-secret-1234';

  function makeSignature(body: unknown, secret: string): string {
    return `sha256=${createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex')}`;
  }

  it('passes when WHATSAPP_APP_SECRET is not configured (dev mode)', () => {
    expect(verifySignature({}, undefined, undefined)).toBe(true);
  });

  it('passes with a valid signature', () => {
    const body = { entry: [{ id: 'test' }] };
    const sig = makeSignature(body, SECRET);
    expect(verifySignature(body, sig, SECRET)).toBe(true);
  });

  it('rejects when signature header is missing', () => {
    expect(verifySignature({}, undefined, SECRET)).toBe(false);
  });

  it('rejects with a tampered body', () => {
    const body = { entry: [{ id: 'test' }] };
    const sig = makeSignature(body, SECRET);
    const tamperedBody = { entry: [{ id: 'evil' }] };
    expect(verifySignature(tamperedBody, sig, SECRET)).toBe(false);
  });

  it('rejects with a wrong secret', () => {
    const body = { entry: [] };
    const sig = makeSignature(body, 'wrong-secret');
    expect(verifySignature(body, sig, SECRET)).toBe(false);
  });

  it('rejects a signature with mismatched length (prevents timing attack padding)', () => {
    const body = {};
    expect(verifySignature(body, 'sha256=tooshort', SECRET)).toBe(false);
  });
});
