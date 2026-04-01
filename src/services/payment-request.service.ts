import { randomBytes } from 'crypto';
import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('payment-request');

// ─── Types ──────────────────────────────────────────────

export type PaymentRequestStatus = 'pending' | 'paid' | 'declined' | 'expired' | 'cancelled';

export interface PaymentRequest {
  id: string;
  requesterId: string;
  requesterName: string;
  requesterPhone: string;
  targetPhone: string;
  targetName: string | null;
  amount: number;
  description: string;
  status: PaymentRequestStatus;
  transactionRef: string | null;
  expiresAt: string;
  createdAt: string;
  respondedAt: string | null;
}

export interface CreatePaymentRequestInput {
  requesterId: string;
  requesterName: string;
  requesterPhone: string;
  targetPhone: string;
  targetName?: string;
  amount: number;
  description: string;
  expiresInHours?: number;
}

const REQ_PREFIX = 'payreq:';
const SENT_PREFIX = 'payreq:sent:';
const RECEIVED_PREFIX = 'payreq:recv:';
const REQ_TTL = 7 * 24 * 60 * 60; // 7 days
const MAX_PENDING_PER_USER = 20;

// ─── Service ────────────────────────────────────────────

export class PaymentRequestService {
  /**
   * Create a payment request.
   */
  async createRequest(input: CreatePaymentRequestInput): Promise<PaymentRequest> {
    if (input.amount < 100) throw new Error('Monto mínimo es $100');
    if (input.amount > 50_000_000) throw new Error('Monto máximo es $50.000.000');
    if (!input.description || input.description.length > 100) {
      throw new Error('Descripción debe tener entre 1 y 100 caracteres');
    }
    if (!input.targetPhone) throw new Error('Teléfono del receptor requerido');

    const normalizedTarget = input.targetPhone.replace(/\s/g, '');
    if (normalizedTarget === input.requesterPhone.replace(/\s/g, '')) {
      throw new Error('No puedes solicitar pago a ti mismo');
    }

    // Check pending limit
    const sent = await this.getSentRequests(input.requesterId);
    const pendingCount = sent.filter(r => r.status === 'pending').length;
    if (pendingCount >= MAX_PENDING_PER_USER) {
      throw new Error(`Máximo ${MAX_PENDING_PER_USER} solicitudes pendientes`);
    }

    const hours = input.expiresInHours ?? 72; // default 3 days
    const expiresAt = new Date(Date.now() + hours * 3600000).toISOString();

    const request: PaymentRequest = {
      id: `preq_${randomBytes(8).toString('hex')}`,
      requesterId: input.requesterId,
      requesterName: input.requesterName,
      requesterPhone: input.requesterPhone.replace(/\s/g, ''),
      targetPhone: normalizedTarget,
      targetName: input.targetName ?? null,
      amount: input.amount,
      description: input.description,
      status: 'pending',
      transactionRef: null,
      expiresAt,
      createdAt: new Date().toISOString(),
      respondedAt: null,
    };

    try {
      const redis = getRedis();
      await redis.set(`${REQ_PREFIX}${request.id}`, JSON.stringify(request), { EX: REQ_TTL });

      // Sent index
      const sentKey = `${SENT_PREFIX}${input.requesterId}`;
      const sentRaw = await redis.get(sentKey);
      const sentList: string[] = sentRaw ? JSON.parse(sentRaw) : [];
      sentList.push(request.id);
      await redis.set(sentKey, JSON.stringify(sentList), { EX: REQ_TTL });

      // Received index (by phone)
      const recvKey = `${RECEIVED_PREFIX}${normalizedTarget}`;
      const recvRaw = await redis.get(recvKey);
      const recvList: string[] = recvRaw ? JSON.parse(recvRaw) : [];
      recvList.push(request.id);
      await redis.set(recvKey, JSON.stringify(recvList), { EX: REQ_TTL });

      log.info('Payment request created', { id: request.id, amount: request.amount, target: normalizedTarget });
    } catch (err) {
      log.warn('Failed to save payment request', { error: (err as Error).message });
    }

    return request;
  }

  /**
   * Get a request by ID.
   */
  async getRequest(requestId: string): Promise<PaymentRequest | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${REQ_PREFIX}${requestId}`);
      if (!raw) return null;

      const request: PaymentRequest = JSON.parse(raw);
      // Auto-expire
      if (request.status === 'pending' && new Date(request.expiresAt) < new Date()) {
        request.status = 'expired';
        await redis.set(`${REQ_PREFIX}${requestId}`, JSON.stringify(request));
      }
      return request;
    } catch {
      return null;
    }
  }

  /**
   * Get requests sent by a user.
   */
  async getSentRequests(userId: string): Promise<PaymentRequest[]> {
    return this.getByIndex(`${SENT_PREFIX}${userId}`);
  }

  /**
   * Get requests received by a phone number.
   */
  async getReceivedRequests(phone: string): Promise<PaymentRequest[]> {
    const normalized = phone.replace(/\s/g, '');
    return this.getByIndex(`${RECEIVED_PREFIX}${normalized}`);
  }

  /**
   * Pay a request.
   */
  async payRequest(requestId: string, transactionRef: string): Promise<PaymentRequest | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${REQ_PREFIX}${requestId}`);
      if (!raw) return null;

      const request: PaymentRequest = JSON.parse(raw);
      if (request.status !== 'pending') {
        throw new Error(`Solicitud no está pendiente (estado: ${request.status})`);
      }
      if (new Date(request.expiresAt) < new Date()) {
        request.status = 'expired';
        await redis.set(`${REQ_PREFIX}${requestId}`, JSON.stringify(request));
        throw new Error('Solicitud expirada');
      }

      request.status = 'paid';
      request.transactionRef = transactionRef;
      request.respondedAt = new Date().toISOString();

      await redis.set(`${REQ_PREFIX}${requestId}`, JSON.stringify(request), { EX: REQ_TTL });
      log.info('Payment request paid', { id: requestId, ref: transactionRef });
      return request;
    } catch (err) {
      if ((err as Error).message.includes('pendiente') || (err as Error).message.includes('expirada')) throw err;
      return null;
    }
  }

  /**
   * Decline a request.
   */
  async declineRequest(requestId: string): Promise<PaymentRequest | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${REQ_PREFIX}${requestId}`);
      if (!raw) return null;

      const request: PaymentRequest = JSON.parse(raw);
      if (request.status !== 'pending') return null;

      request.status = 'declined';
      request.respondedAt = new Date().toISOString();

      await redis.set(`${REQ_PREFIX}${requestId}`, JSON.stringify(request), { EX: REQ_TTL });
      log.info('Payment request declined', { id: requestId });
      return request;
    } catch {
      return null;
    }
  }

  /**
   * Cancel a sent request.
   */
  async cancelRequest(requestId: string, userId: string): Promise<boolean> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${REQ_PREFIX}${requestId}`);
      if (!raw) return false;

      const request: PaymentRequest = JSON.parse(raw);
      if (request.requesterId !== userId) return false;
      if (request.status !== 'pending') return false;

      request.status = 'cancelled';
      request.respondedAt = new Date().toISOString();

      await redis.set(`${REQ_PREFIX}${requestId}`, JSON.stringify(request), { EX: REQ_TTL });
      return true;
    } catch {
      return false;
    }
  }

  // ─── Helpers ──────────────────────────────────────────

  private async getByIndex(key: string): Promise<PaymentRequest[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(key);
      if (!raw) return [];

      const ids: string[] = JSON.parse(raw);
      const requests: PaymentRequest[] = [];
      for (const id of ids) {
        const r = await this.getRequest(id);
        if (r) requests.push(r);
      }
      return requests;
    } catch {
      return [];
    }
  }
}

export const paymentRequest = new PaymentRequestService();
