import { prisma, getRedis } from '../config/database';
import type { Prisma } from '@prisma/client';
import { createLogger } from '../config/logger';
import { generateReference } from '../utils/crypto';
import { formatCLP, formatDateCL, divider } from '../utils/format';
import { WalletService, InsufficientFundsError } from './wallet.service';
import { FraudService } from './fraud.service';
import { audit } from './audit.service';

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

    // 0. Self-payment guard
    if (senderId === receiverId) {
      return { success: false, error: 'No puedes pagarte a ti mismo.' };
    }

    // 1. Per-user frequency limit (10 payments/hour, sliding window)
    const rateLimited = await this.checkUserRateLimit(senderId);
    if (rateLimited) {
      return { success: false, error: 'Demasiados pagos en poco tiempo. Espera un momento e intenta de nuevo.' };
    }

    // 2. Validate amount
    if (amount < 100) {
      return { success: false, error: 'Monto mínimo: $100 CLP.' };
    }

    // 3. Check KYC limits
    const sender = await prisma.user.findUnique({ where: { id: senderId } });
    if (!sender) return { success: false, error: 'Usuario no encontrado.' };

    const limits = LIMITS[sender.kycLevel] || LIMITS.BASIC;
    if (amount > limits.perTx) {
      return {
        success: false,
        error: `Monto máximo por transacción: ${formatCLP(limits.perTx)}. Sube tu nivel de cuenta.`,
      };
    }

    // 4. Fraud check
    const fraudResult = await this.fraud.checkTransaction({
      senderId,
      receiverId,
      amount,
      senderPhone: senderWaId,
      ip: req.ip,
    });

    if (fraudResult.action === 'block') {
      log.warn('Payment blocked by fraud', { senderId, amount, score: fraudResult.score });
      audit.log({
        eventType: 'PAYMENT_BLOCKED',
        actorType: 'SYSTEM',
        targetUserId: senderId,
        amount,
        metadata: { receiverId, fraudScore: fraudResult.score, reasons: fraudResult.reasons },
        status: 'BLOCKED',
      });
      return {
        success: false,
        error:
          'Esta transacción fue bloqueada por seguridad. Si crees que es un error, contacta /soporte.',
        fraudBlocked: true,
      };
    }

    // 5. Calculate fee (P2P wallet = free)
    const isP2P = req.paymentMethod === 'WALLET';
    const fee = isP2P ? 0 : this.calculateFee(amount, req.paymentMethod);
    const reference = generateReference();

    // 6. Execute payment atomically (record + transfer + status in one transaction)
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

        // Monthly limit check INSIDE transaction: wallet row is locked so no concurrent
        // payment can slip in between the aggregate read and the debit below
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        const monthlyAgg = await tx.transaction.aggregate({
          where: { senderId, status: 'COMPLETED', createdAt: { gte: startOfMonth } },
          _sum: { amount: true },
        });
        if (Number(monthlyAgg._sum.amount ?? 0) + amount > limits.monthly) {
          throw new MonthlyLimitExceededError(limits.monthly);
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

      // Record for per-user rate limit
      await this.recordUserPayment(senderId);

      log.info('Payment completed', {
        transactionId: result.transactionId,
        reference,
        amount,
        fee,
        fraudScore: fraudResult.score,
      });

      audit.log({
        eventType: 'PAYMENT_COMPLETED',
        actorType: 'USER',
        actorId: senderId,
        targetUserId: senderId,
        amount,
        transactionId: result.transactionId,
        metadata: { receiverId, reference, fee, fraudScore: fraudResult.score, paymentMethod: req.paymentMethod },
      });

      return {
        success: true,
        reference,
        transactionId: result.transactionId,
        fee,
        senderBalance: formatCLP(result.senderBalance),
      };
    } catch (err) {
      if (err instanceof InsufficientFundsError || err instanceof MonthlyLimitExceededError) {
        audit.log({
          eventType: 'PAYMENT_FAILED',
          actorType: 'SYSTEM',
          targetUserId: senderId,
          amount,
          status: 'FAILED',
          errorMessage: (err as Error).message,
          metadata: { receiverId, reference },
        });
        return { success: false, error: err.message };
      }

      log.error('Payment failed', { error: (err as Error).message, senderId, amount });
      return { success: false, error: 'Error al procesar el pago. No se cobró nada.' };
    }
  }

  async getRecentRecipients(
    userId: string,
    limit = 3,
  ): Promise<Array<{ id: string; name: string | null; waId: string }>> {
    const recent = await prisma.transaction.findMany({
      where: { senderId: userId, status: 'COMPLETED' },
      orderBy: { createdAt: 'desc' },
      take: 20, // scan more to get unique recipients
      select: { receiverId: true, receiver: { select: { id: true, name: true, waId: true } } },
    });

    // Deduplicate by receiverId, keep first occurrence (most recent)
    const seen = new Set<string>();
    const unique: Array<{ id: string; name: string | null; waId: string }> = [];
    for (const tx of recent) {
      if (!seen.has(tx.receiverId) && unique.length < limit) {
        seen.add(tx.receiverId);
        unique.push(tx.receiver);
      }
    }
    return unique;
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
    monthlySent: number;
  }> {
    const firstOfMonth = new Date();
    firstOfMonth.setDate(1);
    firstOfMonth.setHours(0, 0, 0, 0);

    const [sent, received, monthly] = await Promise.all([
      prisma.transaction.aggregate({
        where: { senderId: userId, status: 'COMPLETED' },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.transaction.aggregate({
        where: { receiverId: userId, status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: { senderId: userId, status: 'COMPLETED', createdAt: { gte: firstOfMonth } },
        _sum: { amount: true },
      }),
    ]);

    return {
      totalSent: Number(sent._sum.amount ?? 0),
      totalReceived: Number(received._sum.amount ?? 0),
      txCount: sent._count,
      monthlySent: Number(monthly._sum.amount ?? 0),
    };
  }

  async getTransactionByReference(
    reference: string,
    userId: string,
  ): Promise<{
    direction: string;
    amount: string;
    otherParty: string;
    date: string;
    status: string;
    reference: string;
    fee: string;
  } | null> {
    const tx = await prisma.transaction.findFirst({
      where: {
        reference,
        OR: [{ senderId: userId }, { receiverId: userId }],
      },
      include: {
        sender: { select: { name: true, waId: true } },
        receiver: { select: { name: true, waId: true } },
      },
    });

    if (!tx) return null;

    const isSender = tx.senderId === userId;
    return {
      direction: isSender ? 'Enviado' : 'Recibido',
      amount: formatCLP(Number(tx.amount)),
      otherParty: isSender
        ? tx.receiver.name || tx.receiver.waId
        : tx.sender.name || tx.sender.waId,
      date: formatDateCL(tx.createdAt),
      status: tx.status,
      reference: tx.reference,
      fee: formatCLP(Number(tx.fee)),
    };
  }

  async refundTransaction(
    reference: string,
    requesterId: string,
  ): Promise<{ success: boolean; error?: string; refundReference?: string }> {
    // 1. Find the original transaction
    const original = await prisma.transaction.findFirst({
      where: {
        reference,
        status: 'COMPLETED',
        OR: [{ senderId: requesterId }, { receiverId: requesterId }],
      },
    });

    if (!original) {
      return { success: false, error: 'Transacción no encontrada o ya fue revertida.' };
    }

    // 2. Only the receiver (who got the money) can refund
    if (original.receiverId !== requesterId) {
      return { success: false, error: 'Solo quien recibió el pago puede devolverlo.' };
    }

    // 3. Time limit: 72 hours
    const hoursElapsed =
      (Date.now() - original.completedAt!.getTime()) / (1000 * 60 * 60);
    if (hoursElapsed > 72) {
      return { success: false, error: 'Solo puedes devolver pagos de las últimas 72 horas.' };
    }

    const amount = Number(original.amount);
    const refundRef = generateReference();

    // 4. Atomic: debit receiver, credit sender, mark REVERSED, create refund record
    try {
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Lock receiver wallet
        const [receiverWallet] = await tx.$queryRaw<{ balance: string }[]>`
          SELECT balance FROM wallets WHERE user_id = ${requesterId}::uuid FOR UPDATE
        `;
        if (!receiverWallet || Number(receiverWallet.balance) < amount) {
          throw new InsufficientFundsError(Number(receiverWallet?.balance ?? 0), amount);
        }

        // Debit receiver (return money)
        await tx.wallet.update({
          where: { userId: requesterId },
          data: { balance: { decrement: amount } },
        });

        // Credit original sender
        await tx.wallet.update({
          where: { userId: original.senderId },
          data: { balance: { increment: amount } },
        });

        // Mark original transaction as REVERSED
        await tx.transaction.update({
          where: { id: original.id },
          data: { status: 'REVERSED' },
        });

        // Create refund transaction record
        await tx.transaction.create({
          data: {
            senderId: requesterId,
            receiverId: original.senderId,
            amount,
            status: 'COMPLETED',
            paymentMethod: 'WALLET',
            description: `Devolución de ${reference}`,
            reference: refundRef,
            fee: 0,
            completedAt: new Date(),
            metadata: { type: 'REFUND', originalReference: reference },
          },
        });
      });

      log.info('Refund completed', {
        originalReference: reference,
        refundReference: refundRef,
        amount,
        requesterId,
      });

      audit.log({
        eventType: 'REFUND_COMPLETED',
        actorType: 'USER',
        actorId: requesterId,
        targetUserId: requesterId,
        amount,
        metadata: { originalReference: reference, refundReference: refundRef, originalSenderId: original.senderId },
      });

      return { success: true, refundReference: refundRef };
    } catch (err) {
      if (err instanceof InsufficientFundsError) {
        audit.log({
          eventType: 'REFUND_FAILED',
          actorType: 'SYSTEM',
          targetUserId: requesterId,
          amount,
          status: 'FAILED',
          errorMessage: (err as Error).message,
          metadata: { originalReference: reference },
        });
        return { success: false, error: err.message };
      }
      log.error('Refund failed', { error: (err as Error).message, reference });
      return { success: false, error: 'Error al procesar la devolución.' };
    }
  }

  private readonly MAX_PAYMENTS_PER_HOUR = 10;

  private async checkUserRateLimit(userId: string): Promise<boolean> {
    try {
      const redis = getRedis();
      const key = `ratelimit:pay:${userId}`;
      const count = await redis.get(key);
      return parseInt(count || '0', 10) >= this.MAX_PAYMENTS_PER_HOUR;
    } catch {
      return false; // Fail open
    }
  }

  private async recordUserPayment(userId: string): Promise<void> {
    try {
      const redis = getRedis();
      const key = `ratelimit:pay:${userId}`;
      await redis.multi().incr(key).expire(key, 3600).exec();
    } catch {
      // Non-critical
    }
  }

  private calculateFee(amount: number, method: string): number {
    const config = FEES[method] || FEES.WALLET;
    return Math.round(amount * config.percentage) + config.fixed;
  }
}

// ─── Errors ─────────────────────────────────────────────

class MonthlyLimitExceededError extends Error {
  constructor(limit: number) {
    super(`Superarías tu límite mensual de ${formatCLP(limit)}.`);
    this.name = 'MonthlyLimitExceededError';
  }
}
