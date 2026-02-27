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

    // Atomic check-and-debit: balance check + update in one transaction to
    // prevent race conditions (double-spend) from concurrent requests.
    const wallet = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const [row] = await tx.$queryRaw<{ balance: string }[]>`
        SELECT balance FROM wallets WHERE user_id = ${userId}::uuid FOR UPDATE
      `;
      if (!row || Number(row.balance) < amount) {
        throw new InsufficientFundsError(Number(row?.balance ?? 0), amount);
      }
      return tx.wallet.update({
        where: { userId },
        data: { balance: { decrement: amount } },
      });
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
      // Lock sender wallet row (SELECT ... FOR UPDATE) to prevent double-spending
      const [senderWallet] = await tx.$queryRaw<{ balance: string }[]>`
        SELECT balance FROM wallets WHERE user_id = ${senderId}::uuid FOR UPDATE
      `;
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

  async topup(
    userId: string,
    amount: number,
    method: 'WEBPAY_CREDIT' | 'WEBPAY_DEBIT' | 'KHIPU',
    externalRef: string,
    description: string,
  ): Promise<WalletBalance> {
    if (amount <= 0) throw new Error('Amount must be positive');

    let wallet;
    try {
      wallet = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        // Creating transaction record first: unique reference prevents double-credit
        await tx.transaction.create({
          data: {
            senderId: userId,
            receiverId: userId,
            amount,
            status: 'COMPLETED',
            paymentMethod: method,
            description,
            reference: externalRef,
            completedAt: new Date(),
          },
        });

        return tx.wallet.update({
          where: { userId },
          data: { balance: { increment: amount } },
        });
      });
    } catch (err: unknown) {
      // P2002 = unique constraint violation → already processed (idempotent)
      if ((err as { code?: string }).code === 'P2002') {
        log.warn('Top-up already processed (duplicate reference)', { userId, externalRef });
        return this.getBalance(userId);
      }
      throw err;
    }

    log.info('Wallet topped up', { userId, amount, method, externalRef });

    const newBalance = Number(wallet.balance);
    return {
      balance: newBalance,
      formatted: formatCLP(newBalance),
      currency: wallet.currency,
    };
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
