import { randomBytes } from 'crypto';

// ─── Types ──────────────────────────────────────────────

interface CreatePaymentParams {
  senderId: string;
  receiverId: string;
  amount: number;        // En pesos CLP
  paymentMethod: 'WALLET' | 'WEBPAY_CREDIT' | 'WEBPAY_DEBIT' | 'KHIPU';
  description?: string;
  paymentLinkId?: string;
}

interface PaymentResult {
  transactionId: string;
  reference: string;
  status: 'COMPLETED' | 'PENDING' | 'FAILED';
  fee: number;
  message: string;
}

interface FeeCalculation {
  grossAmount: number;
  fee: number;
  netAmount: number;
  feePercentage: number;
}

// ─── Fee Structure ──────────────────────────────────────

const FEE_TABLE = {
  WALLET: { percentage: 0.015, fixed: 0 },         // 1.5% para comercio
  WEBPAY_CREDIT: { percentage: 0.028, fixed: 50 }, // 2.8% + $50
  WEBPAY_DEBIT: { percentage: 0.018, fixed: 50 },  // 1.8% + $50
  KHIPU: { percentage: 0.01, fixed: 0 },           // 1.0%
} as const;

// P2P wallet transfers are free
const P2P_FREE = true;

// ─── Payment Service ────────────────────────────────────

export class PaymentService {
  generateReference(): string {
    const year = new Date().getFullYear();
    const random = randomBytes(4).toString('hex').toUpperCase();
    return `#WP-${year}-${random}`;
  }

  calculateFee(amount: number, method: keyof typeof FEE_TABLE, isP2P: boolean): FeeCalculation {
    if (isP2P && method === 'WALLET') {
      return {
        grossAmount: amount,
        fee: 0,
        netAmount: amount,
        feePercentage: 0,
      };
    }

    const feeConfig = FEE_TABLE[method];
    const fee = Math.round(amount * feeConfig.percentage) + feeConfig.fixed;

    return {
      grossAmount: amount,
      fee,
      netAmount: amount - fee,
      feePercentage: feeConfig.percentage * 100,
    };
  }

  validateTransactionLimits(
    amount: number,
    kycLevel: 'BASIC' | 'INTERMEDIATE' | 'FULL',
    monthlyTotal: number
  ): { valid: boolean; reason?: string } {
    const limits = {
      BASIC: { perTransaction: 50_000, monthly: 200_000 },
      INTERMEDIATE: { perTransaction: 500_000, monthly: 2_000_000 },
      FULL: { perTransaction: 2_000_000, monthly: Infinity },
    };

    const userLimits = limits[kycLevel];

    if (amount < 100) {
      return { valid: false, reason: 'El monto mínimo es $100 CLP' };
    }

    if (amount > userLimits.perTransaction) {
      return {
        valid: false,
        reason: `El monto máximo por transacción es $${userLimits.perTransaction.toLocaleString('es-CL')} CLP para tu nivel de cuenta`,
      };
    }

    if (monthlyTotal + amount > userLimits.monthly) {
      return {
        valid: false,
        reason: `Superarías tu límite mensual de $${userLimits.monthly.toLocaleString('es-CL')} CLP. Sube de nivel para aumentar tu límite.`,
      };
    }

    return { valid: true };
  }

  generatePaymentLinkCode(): string {
    return randomBytes(4).toString('base64url').slice(0, 6);
  }

  formatAmount(amount: number): string {
    return new Intl.NumberFormat('es-CL', {
      style: 'currency',
      currency: 'CLP',
      minimumFractionDigits: 0,
    }).format(amount);
  }
}
