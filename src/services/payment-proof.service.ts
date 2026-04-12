import { createHmac } from 'crypto';
import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('payment-proof');

const PROOF_PREFIX = 'proof:';
const PROOF_TTL = 365 * 24 * 60 * 60;
const PROOF_SECRET = process.env.PROOF_HMAC_SECRET || 'whatpay-proof-secret-key-2026';

export interface PaymentProof {
  id: string;
  senderId: string;
  senderPhone: string;
  receiverId: string;
  receiverPhone: string;
  amount: number;
  reference: string;
  description: string | null;
  hash: string;
  timestamp: string;
  expiresAt: string;
}

export class PaymentProofService {
  generateProof(data: {
    senderId: string;
    senderPhone: string;
    receiverId: string;
    receiverPhone: string;
    amount: number;
    reference: string;
    description?: string;
  }): PaymentProof {
    const timestamp = new Date().toISOString();
    const id = `proof_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

    const payload = `${id}|${data.senderId}|${data.receiverId}|${data.amount}|${data.reference}|${timestamp}`;
    const hash = createHmac('sha256', PROOF_SECRET).update(payload).digest('hex');

    const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

    return {
      id,
      senderId: data.senderId,
      senderPhone: data.senderPhone,
      receiverId: data.receiverId,
      receiverPhone: data.receiverPhone,
      amount: data.amount,
      reference: data.reference,
      description: data.description ?? null,
      hash,
      timestamp,
      expiresAt,
    };
  }

  async saveProof(proof: PaymentProof): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${PROOF_PREFIX}${proof.id}`, JSON.stringify(proof), { EX: PROOF_TTL });
    } catch (err) {
      log.warn('Failed to save proof', { proofId: proof.id, error: (err as Error).message });
    }
  }

  async getProof(proofId: string): Promise<PaymentProof | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${PROOF_PREFIX}${proofId}`);
      return raw ? JSON.parse(raw) as PaymentProof : null;
    } catch {
      return null;
    }
  }

  verifyProof(proof: PaymentProof): boolean {
    const payload = `${proof.id}|${proof.senderId}|${proof.receiverId}|${proof.amount}|${proof.reference}|${proof.timestamp}`;
    const expected = createHmac('sha256', PROOF_SECRET).update(payload).digest('hex');
    return expected === proof.hash;
  }

  isExpired(proof: PaymentProof): boolean {
    return new Date() > new Date(proof.expiresAt);
  }

  formatForWhatsApp(proof: PaymentProof): string {
    return [
      `Comprobante WhatPay`,
      `Ref: ${proof.reference}`,
      `De: ${proof.senderPhone}`,
      `Para: ${proof.receiverPhone}`,
      `Monto: ${formatCLP(proof.amount)}`,
      `Fecha: ${new Date(proof.timestamp).toLocaleString('es-CL')}`,
      `ID: ${proof.id}`,
      `Verificar: whatpay.cl/verify/${proof.id}`,
    ].join('\n');
  }

  formatCertificate(proof: PaymentProof): string {
    return [
      '════════════════════════════════',
      '     CERTIFICADO DE PAGO',
      '        WhatPay Chile',
      '════════════════════════════════',
      '',
      `Referencia: ${proof.reference}`,
      `Emisor: ${proof.senderPhone}`,
      `Receptor: ${proof.receiverPhone}`,
      `Monto: ${formatCLP(proof.amount)}`,
      proof.description ? `Descripción: ${proof.description}` : '',
      `Fecha: ${new Date(proof.timestamp).toLocaleString('es-CL')}`,
      '',
      `ID Comprobante: ${proof.id}`,
      `Hash: ${proof.hash.slice(0, 16)}...`,
      `Válido hasta: ${new Date(proof.expiresAt).toLocaleDateString('es-CL')}`,
      '',
      '════════════════════════════════',
    ].filter(Boolean).join('\n');
  }
}

export const paymentProof = new PaymentProofService();
