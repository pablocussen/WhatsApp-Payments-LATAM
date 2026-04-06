import { randomBytes } from 'crypto';
import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { TransactionService } from './transaction.service';
import { formatCLP } from '../utils/format';

const log = createLogger('batch-payment');

const BATCH_PREFIX = 'batch:';
const BATCH_TTL = 30 * 24 * 60 * 60; // 30 days

export type BatchStatus = 'pending' | 'processing' | 'completed' | 'partial' | 'failed';

export interface BatchPaymentItem {
  receiverId: string;
  receiverName: string;
  amount: number;
  description?: string;
}

export interface BatchPaymentResult {
  receiverId: string;
  receiverName: string;
  amount: number;
  status: 'success' | 'failed';
  reference?: string;
  error?: string;
}

export interface BatchPayment {
  id: string;
  senderId: string;
  senderWaId: string;
  items: BatchPaymentItem[];
  results: BatchPaymentResult[];
  status: BatchStatus;
  totalAmount: number;
  totalFees: number;
  successCount: number;
  failCount: number;
  createdAt: string;
  completedAt: string | null;
}

const MAX_BATCH_SIZE = 50;
const MIN_AMOUNT = 100;
const MAX_AMOUNT = 2_000_000;

export class BatchPaymentService {
  private transactions = new TransactionService();

  /**
   * Create and process a batch payment.
   * Each item is processed independently — partial success is possible.
   */
  async processBatch(input: {
    senderId: string;
    senderWaId: string;
    items: BatchPaymentItem[];
  }): Promise<BatchPayment> {
    // Validate
    if (!input.items || input.items.length === 0) {
      throw new Error('Debe incluir al menos un pago.');
    }
    if (input.items.length > MAX_BATCH_SIZE) {
      throw new Error(`Máximo ${MAX_BATCH_SIZE} pagos por lote.`);
    }

    for (const item of input.items) {
      if (!item.receiverId) throw new Error('receiverId requerido en cada item.');
      if (item.amount < MIN_AMOUNT || item.amount > MAX_AMOUNT) {
        throw new Error(`Monto debe ser entre ${formatCLP(MIN_AMOUNT)} y ${formatCLP(MAX_AMOUNT)}.`);
      }
      if (item.receiverId === input.senderId) {
        throw new Error('No puedes enviarte pago a ti mismo.');
      }
    }

    const totalAmount = input.items.reduce((sum, i) => sum + i.amount, 0);

    const batch: BatchPayment = {
      id: `bat_${randomBytes(8).toString('hex')}`,
      senderId: input.senderId,
      senderWaId: input.senderWaId,
      items: input.items,
      results: [],
      status: 'processing',
      totalAmount,
      totalFees: 0,
      successCount: 0,
      failCount: 0,
      createdAt: new Date().toISOString(),
      completedAt: null,
    };

    // Process each payment sequentially (to avoid race conditions on balance)
    for (const item of input.items) {
      try {
        const result = await this.transactions.processP2PPayment({
          senderId: input.senderId,
          senderWaId: input.senderWaId,
          receiverId: item.receiverId,
          amount: item.amount,
          paymentMethod: 'WALLET',
          description: item.description ?? `Pago lote ${batch.id}`,
        });

        if (result.success) {
          batch.results.push({
            receiverId: item.receiverId,
            receiverName: item.receiverName,
            amount: item.amount,
            status: 'success',
            reference: result.reference,
          });
          batch.successCount++;
          batch.totalFees += result.fee ?? 0;
        } else {
          batch.results.push({
            receiverId: item.receiverId,
            receiverName: item.receiverName,
            amount: item.amount,
            status: 'failed',
            error: result.error ?? 'Error desconocido',
          });
          batch.failCount++;
        }
      } catch (err) {
        batch.results.push({
          receiverId: item.receiverId,
          receiverName: item.receiverName,
          amount: item.amount,
          status: 'failed',
          error: (err as Error).message,
        });
        batch.failCount++;
      }
    }

    // Determine final status
    if (batch.successCount === input.items.length) {
      batch.status = 'completed';
    } else if (batch.successCount === 0) {
      batch.status = 'failed';
    } else {
      batch.status = 'partial';
    }

    batch.completedAt = new Date().toISOString();

    // Store batch record
    try {
      const redis = getRedis();
      await redis.set(`${BATCH_PREFIX}${batch.id}`, JSON.stringify(batch), { EX: BATCH_TTL });
    } catch (err) {
      log.warn('Failed to store batch', { batchId: batch.id, error: (err as Error).message });
    }

    log.info('Batch payment processed', {
      batchId: batch.id,
      items: input.items.length,
      successCount: batch.successCount,
      failCount: batch.failCount,
      totalAmount,
      status: batch.status,
    });

    return batch;
  }

  /**
   * Get a batch payment by ID.
   */
  async getBatch(batchId: string): Promise<BatchPayment | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${BATCH_PREFIX}${batchId}`);
      if (!raw) return null;
      return JSON.parse(raw) as BatchPayment;
    } catch {
      return null;
    }
  }
}

export const batchPayments = new BatchPaymentService();
