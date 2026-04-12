jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantWebhookSignatureService } from '../../src/services/merchant-webhook-signature.service';

describe('MerchantWebhookSignatureService', () => {
  let s: MerchantWebhookSignatureService;
  beforeEach(() => { s = new MerchantWebhookSignatureService(); });

  it('signs payload', () => {
    const sig = s.signPayload('test', 'secret');
    expect(sig).toHaveLength(64);
  });

  it('verifies valid signature', () => {
    const sig = s.signPayload('test', 'secret');
    expect(s.verifySignature('test', sig, 'secret')).toBe(true);
  });

  it('rejects invalid signature', () => {
    const sig = s.signPayload('test', 'secret');
    expect(s.verifySignature('tampered', sig, 'secret')).toBe(false);
  });

  it('rejects wrong secret', () => {
    const sig = s.signPayload('test', 'secret');
    expect(s.verifySignature('test', sig, 'wrong')).toBe(false);
  });

  it('generates secret with prefix', () => {
    const secret = s.generateSecret();
    expect(secret).toMatch(/^whsec_/);
    expect(secret.length).toBeGreaterThan(40);
  });

  it('builds signature header', () => {
    const header = s.buildSignatureHeader('payload', 'secret', 1234567890);
    expect(header).toContain('t=1234567890');
    expect(header).toContain('v1=');
  });

  it('parses valid header', () => {
    const parsed = s.parseSignatureHeader('t=1234567890,v1=abc123');
    expect(parsed?.timestamp).toBe(1234567890);
    expect(parsed?.signature).toBe('abc123');
  });

  it('returns null for invalid header', () => {
    expect(s.parseSignatureHeader('invalid')).toBeNull();
  });

  it('verifies valid header', () => {
    const header = s.buildSignatureHeader('payload', 'secret');
    expect(s.verifyHeader('payload', header, 'secret')).toBe(true);
  });

  it('rejects old timestamp', () => {
    const header = s.buildSignatureHeader('payload', 'secret', 1000);
    expect(s.verifyHeader('payload', header, 'secret')).toBe(false);
  });

  it('rejects tampered payload', () => {
    const header = s.buildSignatureHeader('payload', 'secret');
    expect(s.verifyHeader('tampered', header, 'secret')).toBe(false);
  });
});
