import { randomBytes } from 'crypto';
import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP, formatDateCL } from '../utils/format';

const log = createLogger('receipts');

// ─── Types ──────────────────────────────────────────────

export type ReceiptType = 'payment' | 'topup' | 'refund' | 'subscription';

export interface Receipt {
  id: string;
  type: ReceiptType;
  reference: string;
  senderName: string;
  senderPhone: string;
  receiverName: string;
  receiverPhone: string;
  amount: number;
  fee: number;
  netAmount: number;
  description: string | null;
  paymentMethod: string;
  status: string;
  createdAt: string;
  formattedText: string;         // pre-rendered WhatsApp-friendly text
}

export interface CreateReceiptInput {
  type: ReceiptType;
  reference: string;
  senderName: string;
  senderPhone: string;
  receiverName: string;
  receiverPhone: string;
  amount: number;
  fee: number;
  description?: string;
  paymentMethod: string;
  status: string;
  createdAt?: string;
}

const RECEIPT_PREFIX = 'receipt:';
const USER_RECEIPTS_PREFIX = 'receipt:user:';
const RECEIPT_TTL = 90 * 24 * 60 * 60; // 90 days
const MAX_USER_RECEIPTS = 50;

// ─── Service ────────────────────────────────────────────

export class ReceiptService {
  /**
   * Generate a receipt for a transaction.
   */
  async generate(input: CreateReceiptInput): Promise<Receipt> {
    const netAmount = input.amount - input.fee;
    const now = input.createdAt ?? new Date().toISOString();

    const receipt: Receipt = {
      id: `rcp_${randomBytes(8).toString('hex')}`,
      type: input.type,
      reference: input.reference,
      senderName: input.senderName,
      senderPhone: input.senderPhone,
      receiverName: input.receiverName,
      receiverPhone: input.receiverPhone,
      amount: input.amount,
      fee: input.fee,
      netAmount,
      description: input.description ?? null,
      paymentMethod: input.paymentMethod,
      status: input.status,
      createdAt: now,
      formattedText: this.formatReceipt(input, netAmount, now),
    };

    try {
      const redis = getRedis();
      await redis.set(`${RECEIPT_PREFIX}${receipt.id}`, JSON.stringify(receipt), { EX: RECEIPT_TTL });

      // Index by sender and receiver
      await this.addToIndex(input.senderPhone, receipt.id);
      await this.addToIndex(input.receiverPhone, receipt.id);
    } catch (err) {
      log.warn('Failed to save receipt', { receiptId: receipt.id, error: (err as Error).message });
    }

    return receipt;
  }

  /**
   * Get a receipt by ID.
   */
  async getReceipt(receiptId: string): Promise<Receipt | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${RECEIPT_PREFIX}${receiptId}`);
      if (!raw) return null;
      return JSON.parse(raw) as Receipt;
    } catch {
      return null;
    }
  }

  /**
   * Get receipts for a user by phone.
   */
  async getUserReceipts(phone: string, limit = 20): Promise<Receipt[]> {
    try {
      const redis = getRedis();
      const idsRaw = await redis.get(`${USER_RECEIPTS_PREFIX}${phone}`);
      if (!idsRaw) return [];

      const ids = (JSON.parse(idsRaw) as string[]).slice(0, limit);
      const receipts: Receipt[] = [];

      for (const id of ids) {
        const receipt = await this.getReceipt(id);
        if (receipt) receipts.push(receipt);
      }

      return receipts;
    } catch {
      return [];
    }
  }

  /**
   * Find receipt by transaction reference.
   */
  async findByReference(phone: string, reference: string): Promise<Receipt | null> {
    const receipts = await this.getUserReceipts(phone, MAX_USER_RECEIPTS);
    return receipts.find((r) => r.reference === reference) ?? null;
  }

  // ─── Helpers ────────────────────────────────────────────

  private formatReceipt(input: CreateReceiptInput, netAmount: number, timestamp: string): string {
    const typeLabel = this.getTypeLabel(input.type);
    const lines = [
      `📄 *Comprobante de ${typeLabel}*`,
      `━━━━━━━━━━━━━━━━━━━`,
      `📋 Ref: ${input.reference}`,
      `📅 Fecha: ${formatDateCL(new Date(timestamp))}`,
      ``,
      `👤 De: ${input.senderName}`,
      `👤 Para: ${input.receiverName}`,
      ``,
      `💰 Monto: ${formatCLP(input.amount)}`,
    ];

    if (input.fee > 0) {
      lines.push(`📊 Comisión: ${formatCLP(input.fee)}`);
      lines.push(`💵 Neto: ${formatCLP(netAmount)}`);
    }

    if (input.description) {
      lines.push(`📝 Detalle: ${input.description}`);
    }

    lines.push(``, `✅ Estado: ${input.status}`);
    lines.push(`💳 Método: ${input.paymentMethod}`);
    lines.push(`━━━━━━━━━━━━━━━━━━━`);
    lines.push(`_WhatPay Chile_`);

    return lines.join('\n');
  }

  private getTypeLabel(type: ReceiptType): string {
    switch (type) {
      case 'payment': return 'Pago';
      case 'topup': return 'Recarga';
      case 'refund': return 'Devolución';
      case 'subscription': return 'Suscripción';
    }
  }

  private async addToIndex(phone: string, receiptId: string): Promise<void> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${USER_RECEIPTS_PREFIX}${phone}`);
      const ids: string[] = raw ? JSON.parse(raw) : [];
      ids.unshift(receiptId); // newest first
      const trimmed = ids.slice(0, MAX_USER_RECEIPTS);
      await redis.set(`${USER_RECEIPTS_PREFIX}${phone}`, JSON.stringify(trimmed), { EX: RECEIPT_TTL });
    } catch {
      // Silent
    }
  }
}

export const receipts = new ReceiptService();
