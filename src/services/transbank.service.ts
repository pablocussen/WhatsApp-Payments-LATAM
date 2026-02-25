import { createLogger } from '../config/logger';
import { env } from '../config/environment';

const log = createLogger('transbank');

// ─── Types ──────────────────────────────────────────────

export interface WebPayTransaction {
  token: string;
  url: string;
}

export interface WebPayResult {
  status: 'AUTHORIZED' | 'FAILED' | 'NULLIFIED';
  amount: number;
  authorizationCode?: string;
  transactionDate?: string;
  cardLast4?: string;
  paymentType?: string; // VN (crédito), VD (débito), etc.
}

// ─── Transbank WebPay Plus ──────────────────────────────

export class TransbankService {
  private baseUrl: string;
  private commerceCode: string;
  private apiKey: string;

  constructor() {
    this.commerceCode = env.TRANSBANK_COMMERCE_CODE;
    this.apiKey = env.TRANSBANK_API_KEY;
    this.baseUrl = env.TRANSBANK_ENVIRONMENT === 'production'
      ? 'https://webpay3g.transbank.cl'
      : 'https://webpay3gint.transbank.cl';
  }

  /**
   * Crea una transacción WebPay Plus para recarga de wallet.
   * Retorna el token y URL de redirección a Transbank.
   */
  async createTransaction(
    buyOrder: string,
    amount: number,
    returnUrl: string
  ): Promise<WebPayTransaction> {
    const response = await fetch(`${this.baseUrl}/rswebpaytransaction/api/webpay/v1.2/transactions`, {
      method: 'POST',
      headers: {
        'Tbk-Api-Key-Id': this.commerceCode,
        'Tbk-Api-Key-Secret': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        buy_order: buyOrder,
        session_id: `session_${Date.now()}`,
        amount,
        return_url: returnUrl,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      log.error('Transbank create transaction failed', { error, buyOrder, amount });
      throw new Error(`Transbank error: ${response.status}`);
    }

    const data: any = await response.json();
    log.info('Transbank transaction created', { buyOrder, amount, token: data.token?.slice(0, 10) });

    return {
      token: data.token,
      url: `${data.url}?token_ws=${data.token}`,
    };
  }

  /**
   * Confirma una transacción después del retorno de Transbank.
   */
  async confirmTransaction(token: string): Promise<WebPayResult> {
    const response = await fetch(
      `${this.baseUrl}/rswebpaytransaction/api/webpay/v1.2/transactions/${token}`,
      {
        method: 'PUT',
        headers: {
          'Tbk-Api-Key-Id': this.commerceCode,
          'Tbk-Api-Key-Secret': this.apiKey,
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      log.error('Transbank confirm failed', { token: token.slice(0, 10) });
      return { status: 'FAILED', amount: 0 };
    }

    const data: any = await response.json();

    const result: WebPayResult = {
      status: data.response_code === 0 ? 'AUTHORIZED' : 'FAILED',
      amount: data.amount,
      authorizationCode: data.authorization_code,
      transactionDate: data.transaction_date,
      cardLast4: data.card_detail?.card_number,
      paymentType: data.payment_type_code,
    };

    log.info('Transbank transaction confirmed', {
      status: result.status,
      amount: result.amount,
      paymentType: result.paymentType,
    });

    return result;
  }

  /**
   * Reversa una transacción (para refunds).
   */
  async refundTransaction(token: string, amount: number): Promise<boolean> {
    const response = await fetch(
      `${this.baseUrl}/rswebpaytransaction/api/webpay/v1.2/transactions/${token}/refunds`,
      {
        method: 'POST',
        headers: {
          'Tbk-Api-Key-Id': this.commerceCode,
          'Tbk-Api-Key-Secret': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ amount }),
      }
    );

    if (!response.ok) {
      log.error('Transbank refund failed', { token: token.slice(0, 10), amount });
      return false;
    }

    log.info('Transbank refund processed', { amount });
    return true;
  }
}
