import { randomBytes } from 'crypto';
import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('qr-payment');

// ─── Types ──────────────────────────────────────────────

export type QrType = 'static' | 'dynamic';
export type QrStatus = 'active' | 'used' | 'expired' | 'cancelled';

export interface QrCode {
  id: string;
  type: QrType;
  merchantId: string | null;    // null = user-to-user
  createdBy: string;            // userId
  amount: number | null;        // null = payer chooses amount
  description: string | null;
  reference: string;            // short code for scanning
  status: QrStatus;
  scannedBy: string | null;
  transactionRef: string | null;
  expiresAt: string | null;     // null = no expiry (static)
  createdAt: string;
  usedAt: string | null;
}

export interface CreateQrInput {
  createdBy: string;
  type: QrType;
  merchantId?: string;
  amount?: number;
  description?: string;
  expiresInMinutes?: number;   // for dynamic QRs
}

const QR_PREFIX = 'qr:';
const QR_REF_PREFIX = 'qr:ref:';
const USER_QR_PREFIX = 'qr:user:';
const QR_TTL = 30 * 24 * 60 * 60;      // 30 days default
const MAX_QR_PER_USER = 20;

// ─── Service ────────────────────────────────────────────

export class QrPaymentService {
  /**
   * Generate a new QR code for payment.
   */
  async generateQr(input: CreateQrInput): Promise<QrCode> {
    if (!input.createdBy) throw new Error('createdBy requerido');
    if (input.amount !== undefined && input.amount !== null) {
      if (input.amount < 100) throw new Error('Monto mínimo es $100');
      if (input.amount > 50_000_000) throw new Error('Monto máximo es $50.000.000');
    }
    if (input.description && input.description.length > 100) {
      throw new Error('Descripción máximo 100 caracteres');
    }

    // Check user's QR limit
    const existing = await this.getUserQrs(input.createdBy);
    const activeCount = existing.filter(q => q.status === 'active').length;
    if (activeCount >= MAX_QR_PER_USER) {
      throw new Error(`Máximo ${MAX_QR_PER_USER} códigos QR activos`);
    }

    // Generate short reference (8 chars, uppercase)
    const reference = randomBytes(4).toString('hex').toUpperCase();

    const now = new Date();
    let expiresAt: string | null = null;
    if (input.type === 'dynamic') {
      const minutes = input.expiresInMinutes ?? 30;
      const exp = new Date(now.getTime() + minutes * 60 * 1000);
      expiresAt = exp.toISOString();
    }

    const qr: QrCode = {
      id: `qr_${randomBytes(8).toString('hex')}`,
      type: input.type,
      merchantId: input.merchantId ?? null,
      createdBy: input.createdBy,
      amount: input.amount ?? null,
      description: input.description ?? null,
      reference,
      status: 'active',
      scannedBy: null,
      transactionRef: null,
      expiresAt,
      createdAt: now.toISOString(),
      usedAt: null,
    };

    try {
      const redis = getRedis();
      const ttl = input.type === 'dynamic'
        ? Math.max(60, (input.expiresInMinutes ?? 30) * 60 + 300) // TTL + 5min buffer
        : QR_TTL;

      await redis.set(`${QR_PREFIX}${qr.id}`, JSON.stringify(qr), { EX: ttl });
      await redis.set(`${QR_REF_PREFIX}${reference}`, qr.id, { EX: ttl });

      // User index
      const userKey = `${USER_QR_PREFIX}${input.createdBy}`;
      const userRaw = await redis.get(userKey);
      const userQrs: string[] = userRaw ? JSON.parse(userRaw) : [];
      userQrs.push(qr.id);
      await redis.set(userKey, JSON.stringify(userQrs), { EX: QR_TTL });

      log.info('QR code generated', { id: qr.id, type: qr.type, reference, amount: qr.amount });
    } catch (err) {
      log.warn('Failed to save QR code', { error: (err as Error).message });
    }

    return qr;
  }

  /**
   * Resolve a QR code by reference (scan).
   */
  async resolveQr(reference: string): Promise<QrCode | null> {
    try {
      const redis = getRedis();
      const qrId = await redis.get(`${QR_REF_PREFIX}${reference.toUpperCase()}`);
      if (!qrId) return null;

      const raw = await redis.get(`${QR_PREFIX}${qrId}`);
      if (!raw) return null;

      const qr: QrCode = JSON.parse(raw);

      // Check expiry
      if (qr.expiresAt && new Date(qr.expiresAt) < new Date()) {
        qr.status = 'expired';
        await redis.set(`${QR_PREFIX}${qrId}`, JSON.stringify(qr));
        return qr;
      }

      // Check if already used (dynamic only)
      if (qr.type === 'dynamic' && qr.status === 'used') {
        return qr;
      }

      return qr;
    } catch {
      return null;
    }
  }

  /**
   * Mark a QR as used after payment.
   */
  async markUsed(qrId: string, scannedBy: string, transactionRef: string): Promise<QrCode | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${QR_PREFIX}${qrId}`);
      if (!raw) return null;

      const qr: QrCode = JSON.parse(raw);
      if (qr.status !== 'active') {
        throw new Error(`QR no está activo (estado: ${qr.status})`);
      }
      if (qr.createdBy === scannedBy) {
        throw new Error('No puedes escanear tu propio QR');
      }

      qr.status = qr.type === 'dynamic' ? 'used' : 'active'; // static stays active
      qr.scannedBy = scannedBy;
      qr.transactionRef = transactionRef;
      qr.usedAt = new Date().toISOString();

      await redis.set(`${QR_PREFIX}${qrId}`, JSON.stringify(qr));
      log.info('QR code used', { id: qrId, scannedBy, transactionRef });
      return qr;
    } catch (err) {
      if ((err as Error).message.includes('activo') || (err as Error).message.includes('propio')) throw err;
      return null;
    }
  }

  /**
   * Cancel a QR code.
   */
  async cancelQr(qrId: string, userId: string): Promise<boolean> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${QR_PREFIX}${qrId}`);
      if (!raw) return false;

      const qr: QrCode = JSON.parse(raw);
      if (qr.createdBy !== userId) return false;
      if (qr.status !== 'active') return false;

      qr.status = 'cancelled';
      await redis.set(`${QR_PREFIX}${qrId}`, JSON.stringify(qr));
      // Remove reference lookup
      await redis.del(`${QR_REF_PREFIX}${qr.reference}`);

      log.info('QR code cancelled', { id: qrId });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get QR by ID.
   */
  async getQr(qrId: string): Promise<QrCode | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${QR_PREFIX}${qrId}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  /**
   * Get all QR codes for a user.
   */
  async getUserQrs(userId: string): Promise<QrCode[]> {
    try {
      const redis = getRedis();
      const userRaw = await redis.get(`${USER_QR_PREFIX}${userId}`);
      if (!userRaw) return [];

      const ids: string[] = JSON.parse(userRaw);
      const qrs: QrCode[] = [];

      for (const id of ids) {
        const raw = await redis.get(`${QR_PREFIX}${id}`);
        if (raw) qrs.push(JSON.parse(raw));
      }

      return qrs;
    } catch {
      return [];
    }
  }

  /**
   * Generate QR data URL (text payload for QR image generation).
   */
  getQrPayload(reference: string, baseUrl: string): string {
    return `${baseUrl}/pay/${reference}`;
  }
}

export const qrPayment = new QrPaymentService();
