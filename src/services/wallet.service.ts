import { prisma } from '../config/database';
import type { Prisma } from '@prisma/client';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('wallet-service');

// ─── Types ──────────────────────────────────────────────

export interface WalletBalance {
  balance: number;
  formatted: string;
  currency: string;
}

export interface WalletMovement {
  type: 'credit' | 'debit';
  amount: number;
  description: string;
  reference: string;
  date: Date;
}

// ─── Wallet Service ─────────────────────────────────────

export class WalletService {
  async getBalance(userId: string): Promise<WalletBalance> {
    const wallet = await prisma.wallet.findUnique({
      where: { userId },
    });

    if (!wallet) {
      throw new Error(`Wallet not found for user ${userId}`);
    }

    const balance = Number(wallet.balance);
    return {
      balance,
      formatted: formatCLP(balance),
      currency: wallet.currency,
    };
  }

  async credit(userId: string, amount: number, description: string): Promise<WalletBalance> {
    if (amount <= 0) throw new Error('Amount must be positive');

    const wallet = await prisma.wallet.update({
      where: { userId },
      data: { balance: { increment: amount } },
    });

    log.info('Wallet credited', { userId, amount, description });

    const newBalance = Number(wallet.balance);
    return {
      balance: newBalance,
      formatted: formatCLP(newBalance),
      currency: wallet.currency,
    };
  }

  async debit(userId: string, amount: number, description: string): Promise<WalletBalance> {
    if (amount <= 0) throw new Error('Amount must be positive');

    // Check balance first (prevent negative)
    const current = await prisma.wallet.findUnique({ where: { userId } });
    if (!current || Number(current.balance) < amount) {
      throw new InsufficientFundsError(Number(current?.balance ?? 0), amount);
    }

    const wallet = await prisma.wallet.update({
      where: { userId },
      data: { balance: { decrement: amount } },
    });

    log.info('Wallet debited', { userId, amount, description });

    const newBalance = Number(wallet.balance);
    return {
      balance: newBalance,
      formatted: formatCLP(newBalance),
      currency: wallet.currency,
    };
  }

  async transfer(
    senderId: string,
    receiverId: string,
    amount: number,
    description: string,
  ): Promise<{ senderBalance: WalletBalance; receiverBalance: WalletBalance }> {
    if (senderId === receiverId) throw new Error('Cannot transfer to yourself');
    if (amount <= 0) throw new Error('Amount must be positive');

    // Atomic transfer within a transaction
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Lock sender wallet and check balance
      const senderWallet = await tx.wallet.findUnique({ where: { userId: senderId } });
      if (!senderWallet || Number(senderWallet.balance) < amount) {
        throw new InsufficientFundsError(Number(senderWallet?.balance ?? 0), amount);
      }

      // Debit sender
      const updatedSender = await tx.wallet.update({
        where: { userId: senderId },
        data: { balance: { decrement: amount } },
      });

      // Credit receiver
      const updatedReceiver = await tx.wallet.update({
        where: { userId: receiverId },
        data: { balance: { increment: amount } },
      });

      return { sender: updatedSender, receiver: updatedReceiver };
    });

    log.info('Wallet transfer', { senderId, receiverId, amount, description });

    return {
      senderBalance: {
        balance: Number(result.sender.balance),
        formatted: formatCLP(Number(result.sender.balance)),
        currency: result.sender.currency,
      },
      receiverBalance: {
        balance: Number(result.receiver.balance),
        formatted: formatCLP(Number(result.receiver.balance)),
        currency: result.receiver.currency,
      },
    };
  }

  async getMonthlyTotal(userId: string): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const result = await prisma.transaction.aggregate({
      where: {
        senderId: userId,
        status: 'COMPLETED',
        createdAt: { gte: startOfMonth },
      },
      _sum: { amount: true },
    });

    return Number(result._sum.amount ?? 0);
  }
}

// ─── Errors ─────────────────────────────────────────────

export class InsufficientFundsError extends Error {
  public currentBalance: number;
  public requestedAmount: number;

  constructor(currentBalance: number, requestedAmount: number) {
    super(
      `Saldo insuficiente. Tienes ${formatCLP(currentBalance)} y necesitas ${formatCLP(requestedAmount)}.`,
    );
    this.name = 'InsufficientFundsError';
    this.currentBalance = currentBalance;
    this.requestedAmount = requestedAmount;
  }
}
