import { createHmac } from 'crypto';
import { createLogger } from '../config/logger';
import { env } from '../config/environment';

const log = createLogger('khipu');

const FETCH_TIMEOUT_MS = 30_000;

// ─── Types ──────────────────────────────────────────────

export interface KhipuPayment {
  paymentId: string;
  paymentUrl: string;
  simplifiedTransferUrl: string;
  appUrl: string;
}

export interface KhipuPaymentStatus {
  paymentId: string;
  status: 'pending' | 'done' | 'expired';
  amount: number;
  currency: string;
  payer_name?: string;
  payer_email?: string;
  transaction_id?: string;
}

// ─── Internal API response shapes ───────────────────────

interface KhipuCreateResponse {
  payment_id: string;
  payment_url: string;
  simplified_transfer_url: string;
  app_url: string;
}

interface KhipuStatusResponse {
  payment_id: string;
  status: string;
  amount: number;
  currency: string;
  payer_name?: string;
  payer_email?: string;
  transaction_id?: string;
}

// ─── Khipu Service (Bank Transfers Chile) ───────────────

export class KhipuService {
  private baseUrl = 'https://khipu.com/api/2.0';
  private receiverId: string;
  private secret: string;

  constructor() {
    this.receiverId = env.KHIPU_RECEIVER_ID;
    this.secret = env.KHIPU_SECRET;
  }

  /**
   * Crea un cobro por transferencia bancaria vía Khipu.
   */
  async createPayment(
    subject: string,
    amount: number,
    notifyUrl: string,
    returnUrl: string,
    transactionId: string,
  ): Promise<KhipuPayment> {
    const body = new URLSearchParams({
      subject,
      currency: 'CLP',
      amount: String(amount),
      transaction_id: transactionId,
      notify_url: notifyUrl,
      return_url: returnUrl,
      notify_api_version: '1.3',
    });

    const response = await fetch(`${this.baseUrl}/payments`, {
      method: 'POST',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Authorization: this.getAuthHeader('POST', '/api/2.0/payments', body.toString()),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      log.error('Khipu create payment failed', { error, amount, transactionId });
      throw new Error(`Khipu error: ${response.status}`);
    }

    const data = (await response.json()) as KhipuCreateResponse;

    log.info('Khipu payment created', {
      paymentId: data.payment_id,
      amount,
      transactionId,
    });

    return {
      paymentId: data.payment_id,
      paymentUrl: data.payment_url,
      simplifiedTransferUrl: data.simplified_transfer_url,
      appUrl: data.app_url,
    };
  }

  /**
   * Consulta el estado de un pago Khipu.
   */
  async getPaymentStatus(paymentId: string): Promise<KhipuPaymentStatus> {
    const response = await fetch(`${this.baseUrl}/payments/${paymentId}`, {
      method: 'GET',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        Authorization: this.getAuthHeader('GET', `/api/2.0/payments/${paymentId}`, ''),
      },
    });

    if (!response.ok) {
      log.error('Khipu get status failed', { paymentId });
      throw new Error(`Khipu status error: ${response.status}`);
    }

    const data = (await response.json()) as KhipuStatusResponse;

    return {
      paymentId: data.payment_id,
      status: data.status === 'done' ? 'done' : data.status === 'expired' ? 'expired' : 'pending',
      amount: data.amount,
      currency: data.currency,
      payer_name: data.payer_name,
      payer_email: data.payer_email,
      transaction_id: data.transaction_id,
    };
  }

  /**
   * Verifica la notificación de Khipu (callback).
   * El notification_token es el payment_id de Khipu (formato alfanumérico).
   * La validación real ocurre llamando getPaymentStatus() con este token.
   */
  verifyNotification(notificationToken: string, apiVersion: string): boolean {
    if (apiVersion !== '1.3') return false;
    // payment_id de Khipu: alfanumérico, mínimo 6 caracteres
    return /^[a-zA-Z0-9_-]{6,}$/.test(notificationToken);
  }

  private getAuthHeader(method: string, path: string, body: string): string {
    const toSign = `${method}&${encodeURIComponent(path)}&${encodeURIComponent(body)}`;
    const signature = createHmac('sha256', this.secret).update(toSign).digest('hex');
    return `${this.receiverId}:${signature}`;
  }
}
