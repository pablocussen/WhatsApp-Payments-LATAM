import { prisma } from '../config/database';
import type { Prisma } from '@prisma/client';
import { createLogger } from '../config/logger';
import { generateReference } from '../utils/crypto';
import { formatCLP, formatDateCL, divider } from '../utils/format';
import { WalletService, InsufficientFundsError } from './wallet.service';
import { FraudService } from './fraud.service';

const log = createLogger('transaction-service');

// ─── Types ──────────────────────────────────────────────

export interface PaymentRequest {
  senderId: string;
  senderWaId: string;
  receiverId: string;
  amount: number;
  paymentMethod: 'WALLET' | 'WEBPAY_CREDIT' | 'WEBPAY_DEBIT' | 'KHIPU';
  description?: string;
  paymentLinkId?: string;
  ip?: string;
}

export interface PaymentResponse {
  success: boolean;
  reference?: string;
  transactionId?: string;
  fee?: number;
  senderBalance?: string;
  error?: string;
  fraudBlocked?: boolean;
}

interface FeeConfig {
  percentage: number;
  fixed: number;
}

// ─── Fee Table ──────────────────────────────────────────

const FEES: Record<string, FeeConfig> = {
  WALLET: { percentage: 0.015, fixed: 0 },
  WEBPAY_CREDIT: { percentage: 0.028, fixed: 50 },
  WEBPAY_DEBIT: { percentage: 0.018, fixed: 50 },
  KHIPU: { percentage: 0.01, fixed: 0 },
};

// Transaction limits by KYC level
const LIMITS: Record<string, { perTx: number; monthly: number }> = {
  BASIC: { perTx: 50_000, monthly: 200_000 },
  INTERMEDIATE: { perTx: 500_000, monthly: 2_000_000 },
  FULL: { perTx: 2_000_000, monthly: 50_000_000 },
};

// ─── Transaction Service ────────────────────────────────

export class TransactionService {
  private wallet = new WalletService();
  private fraud = new FraudService();

  async processP2PPayment(req: PaymentRequest): Promise<PaymentResponse> {
    const { senderId, receiverId, amount, senderWaId } = req;

    // 1. Validate amount
    if (amount < 100) {
      return { success: false, error: 'Monto mínimo: $100 CLP.' };
    }

    // 2. Check KYC limits
    const sender = await prisma.user.findUnique({ where: { id: senderId } });
    if (!sender) return { success: false, error: 'Usuario no encontrado.' };

    const limits = LIMITS[sender.kycLevel] || LIMITS.BASIC;
    if (amount > limits.perTx) {
      return {
        success: false,
        error: `Monto máximo por transacción: ${formatCLP(limits.perTx)}. Sube tu nivel de cuenta.`,
      };
    }

    const monthlyTotal = await this.wallet.getMonthlyTotal(senderId);
    if (monthlyTotal + amount > limits.monthly) {
      return {
        success: false,
        error: `Superarías tu límite mensual de ${formatCLP(limits.monthly)}.`,
      };
    }

    // 3. Fraud check
    const fraudResult = await this.fraud.checkTransaction({
      senderId,
      receiverId,
      amount,
      senderPhone: senderWaId,
      ip: req.ip,
    });

    if (fraudResult.action === 'block') {
      log.warn('Payment blocked by fraud', { senderId, amount, score: fraudResult.score });
      return {
        success: false,
        error:
          'Esta transacción fue bloqueada por seguridad. Si crees que es un error, contacta /soporte.',
        fraudBlocked: true,
      };
    }

    // 4. Calculate fee (P2P wallet = free)
    const isP2P = req.paymentMethod === 'WALLET';
    const fee = isP2P ? 0 : this.calculateFee(amount, req.paymentMethod);
    const reference = generateReference();

    // 5. Execute payment atomically (record + transfer + status in one transaction)
    try {
      const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Create transaction record
        const transaction = await tx.transaction.create({
          data: {
            senderId,
            receiverId,
            amount,
            status: 'PROCESSING',
            paymentMethod: req.paymentMethod,
            fraudScore: fraudResult.score,
            fee,
            description: req.description,
            reference,
            paymentLinkId: req.paymentLinkId,
            metadata: {
              fraudReasons: fraudResult.reasons,
              fraudAction: fraudResult.action,
            },
          },
        });

        // Lock sender wallet row (SELECT ... FOR UPDATE) to prevent double-spending
        const [senderWallet] = await tx.$queryRaw<{ balance: string }[]>`
          SELECT balance FROM wallets WHERE user_id = ${senderId}::uuid FOR UPDATE
        `;
        if (!senderWallet || Number(senderWallet.balance) < amount) {
          throw new InsufficientFundsError(Number(senderWallet?.balance ?? 0), amount);
        }

        await tx.wallet.update({
          where: { userId: senderId },
          data: { balance: { decrement: amount } },
        });

        await tx.wallet.update({
          where: { userId: receiverId },
          data: { balance: { increment: amount } },
        });

        // Mark completed within the same transaction
        await tx.transaction.update({
          where: { id: transaction.id },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });

        return {
          transactionId: transaction.id,
          senderBalance: Number(senderWallet.balance) - amount,
        };
      });

      log.info('Payment completed', {
        transactionId: result.transactionId,
        reference,
        amount,
        fee,
        fraudScore: fraudResult.score,
      });

      return {
        success: true,
        reference,
        transactionId: result.transactionId,
        fee,
        senderBalance: formatCLP(result.senderBalance),
      };
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        return { success: false, error: err.message };
      }

      log.error('Payment failed', { error: (err as Error).message, senderId, amount });
      return { success: false, error: 'Error al procesar el pago. No se cobró nada.' };
    }
  }

  async getTransactionHistory(userId: string, limit = 5): Promise<string> {
    const transactions = await prisma.transaction.findMany({
      where: {
        OR: [{ senderId: userId }, { receiverId: userId }],
        status: 'COMPLETED',
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        sender: { select: { name: true, waId: true } },
        receiver: { select: { name: true, waId: true } },
      },
    });

    if (transactions.length === 0) {
      return 'No tienes transacciones aún.';
    }

    const lines = transactions.map((tx: (typeof transactions)[number]) => {
      const isSender = tx.senderId === userId;
      const direction = isSender ? '↑ Enviado' : '↓ Recibido';
      const otherParty = isSender
        ? tx.receiver.name || tx.receiver.waId
        : tx.sender.name || tx.sender.waId;
      const sign = isSender ? '-' : '+';
      const amount = formatCLP(Number(tx.amount));
      const date = formatDateCL(tx.createdAt);

      return `${direction} ${sign}${amount} → ${otherParty}\n  ${tx.reference} | ${date}`;
    });

    return [`Últimas ${transactions.length} transacciones:`, divider(), ...lines, divider()].join(
      '\n',
    );
  }

  async getTransactionStats(userId: string): Promise<{
    totalSent: number;
    totalReceived: number;
    txCount: number;
  }> {
    const [sent, received] = await Promise.all([
      prisma.transaction.aggregate({
        where: { senderId: userId, status: 'COMPLETED' },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.transaction.aggregate({
        where: { receiverId: userId, status: 'COMPLETED' },
        _sum: { amount: true },
      }),
    ]);

    return {
      totalSent: Number(sent._sum.amount ?? 0),
      totalReceived: Number(received._sum.amount ?? 0),
      txCount: sent._count,
    };
  }

  private calculateFee(amount: number, method: string): number {
    const config = FEES[method] || FEES.WALLET;
    return Math.round(amount * config.percentage) + config.fixed;
  }
}
