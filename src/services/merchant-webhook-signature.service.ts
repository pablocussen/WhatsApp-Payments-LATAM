import { createHmac, timingSafeEqual } from 'crypto';
import { createLogger } from '../config/logger';

const log = createLogger('webhook-signature');

export class MerchantWebhookSignatureService {
  signPayload(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex');
  }

  verifySignature(payload: string, signature: string, secret: string): boolean {
    try {
      const expected = this.signPayload(payload, secret);
      const expBuf = Buffer.from(expected, 'hex');
      const sigBuf = Buffer.from(signature, 'hex');
      if (expBuf.length !== sigBuf.length) return false;
      return timingSafeEqual(expBuf, sigBuf);
    } catch (err) {
      log.warn('Signature verification error', { error: (err as Error).message });
      return false;
    }
  }

  generateSecret(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    return 'whsec_' + Array.from({ length: 48 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  buildSignatureHeader(payload: string, secret: string, timestamp?: number): string {
    const ts = timestamp ?? Math.floor(Date.now() / 1000);
    const signedPayload = ts + '.' + payload;
    const sig = this.signPayload(signedPayload, secret);
    return 't=' + ts + ',v1=' + sig;
  }

  parseSignatureHeader(header: string): { timestamp: number; signature: string } | null {
    try {
      const parts = header.split(',');
      const tsPart = parts.find(p => p.startsWith('t='));
      const sigPart = parts.find(p => p.startsWith('v1='));
      if (!tsPart || !sigPart) return null;
      return {
        timestamp: parseInt(tsPart.slice(2), 10),
        signature: sigPart.slice(3),
      };
    } catch {
      return null;
    }
  }

  verifyHeader(payload: string, header: string, secret: string, toleranceSeconds = 300): boolean {
    const parsed = this.parseSignatureHeader(header);
    if (!parsed) return false;

    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parsed.timestamp) > toleranceSeconds) return false;

    const signedPayload = parsed.timestamp + '.' + payload;
    return this.verifySignature(signedPayload, parsed.signature, secret);
  }
}

export const merchantWebhookSignature = new MerchantWebhookSignatureService();
