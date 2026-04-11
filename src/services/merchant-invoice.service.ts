import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('merchant-invoice');

const INV_PREFIX = 'minv:';
const INV_TTL = 365 * 24 * 60 * 60;

export type InvoiceStatus = 'DRAFT' | 'SENT' | 'PAID' | 'OVERDUE' | 'CANCELLED';

export interface InvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

export interface MerchantInvoice {
  id: string;
  merchantId: string;
  customerPhone: string;
  customerName: string | null;
  items: InvoiceItem[];
  subtotal: number;
  tax: number; // IVA 19%
  total: number;
  status: InvoiceStatus;
  dueDate: string;
  paidAt: string | null;
  paymentRef: string | null;
  notes: string | null;
  createdAt: string;
}

const IVA_RATE = 0.19;

export class MerchantInvoiceService {
  async createInvoice(input: {
    merchantId: string;
    customerPhone: string;
    customerName?: string;
    items: { description: string; quantity: number; unitPrice: number }[];
    dueDays?: number;
    notes?: string;
    includeTax?: boolean;
  }): Promise<MerchantInvoice> {
    if (!input.items.length) throw new Error('Debe incluir al menos un ítem.');
    if (input.items.length > 20) throw new Error('Máximo 20 ítems por factura.');

    const items: InvoiceItem[] = input.items.map(i => ({
      description: i.description,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      total: i.quantity * i.unitPrice,
    }));

    const subtotal = items.reduce((sum, i) => sum + i.total, 0);
    const tax = input.includeTax !== false ? Math.round(subtotal * IVA_RATE) : 0;
    const total = subtotal + tax;

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + (input.dueDays ?? 30));

    const invoice: MerchantInvoice = {
      id: `inv_${Date.now().toString(36)}`,
      merchantId: input.merchantId,
      customerPhone: input.customerPhone,
      customerName: input.customerName ?? null,
      items,
      subtotal,
      tax,
      total,
      status: 'DRAFT',
      dueDate: dueDate.toISOString(),
      paidAt: null,
      paymentRef: null,
      notes: input.notes ?? null,
      createdAt: new Date().toISOString(),
    };

    await this.saveInvoice(invoice);
    log.info('Invoice created', { invoiceId: invoice.id, merchantId: input.merchantId, total });
    return invoice;
  }

  async getInvoice(invoiceId: string): Promise<MerchantInvoice | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${INV_PREFIX}${invoiceId}`);
      return raw ? JSON.parse(raw) as MerchantInvoice : null;
    } catch {
      return null;
    }
  }

  async markSent(invoiceId: string): Promise<boolean> {
    return this.updateStatus(invoiceId, 'SENT');
  }

  async markPaid(invoiceId: string, paymentRef: string): Promise<boolean> {
    const invoice = await this.getInvoice(invoiceId);
    if (!invoice) return false;
    invoice.status = 'PAID';
    invoice.paidAt = new Date().toISOString();
    invoice.paymentRef = paymentRef;
    await this.saveInvoice(invoice);
    return true;
  }

  async cancel(invoiceId: string): Promise<boolean> {
    return this.updateStatus(invoiceId, 'CANCELLED');
  }

  async getMerchantInvoices(merchantId: string): Promise<MerchantInvoice[]> {
    try {
      const redis = getRedis();
      const ids = await redis.lRange(`${INV_PREFIX}list:${merchantId}`, 0, 49);
      if (!ids.length) return [];
      const invoices: MerchantInvoice[] = [];
      for (const id of ids) {
        const raw = await redis.get(`${INV_PREFIX}${id}`);
        if (raw) invoices.push(JSON.parse(raw));
      }
      return invoices;
    } catch {
      return [];
    }
  }

  getInvoiceSummary(inv: MerchantInvoice): string {
    return `${inv.id} — ${inv.customerName || inv.customerPhone} — ${formatCLP(inv.total)} — ${inv.status}`;
  }

  private async updateStatus(invoiceId: string, status: InvoiceStatus): Promise<boolean> {
    const invoice = await this.getInvoice(invoiceId);
    if (!invoice) return false;
    invoice.status = status;
    await this.saveInvoice(invoice);
    return true;
  }

  private async saveInvoice(invoice: MerchantInvoice): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${INV_PREFIX}${invoice.id}`, JSON.stringify(invoice), { EX: INV_TTL });
    } catch (err) {
      log.warn('Failed to save invoice', { invoiceId: invoice.id, error: (err as Error).message });
    }
  }
}

export const merchantInvoices = new MerchantInvoiceService();
