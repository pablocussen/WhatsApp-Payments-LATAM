import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-order-fulfillment');
const PREFIX = 'merchant:order-fulfillment:';
const TTL = 180 * 24 * 60 * 60;

export type FulfillmentStatus = 'RECEIVED' | 'PREPARING' | 'READY' | 'DELIVERED' | 'CANCELLED';

export interface OrderItem {
  sku: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface FulfillmentOrder {
  id: string;
  merchantId: string;
  orderNumber: number;
  customerId: string;
  customerName: string;
  items: OrderItem[];
  totalAmount: number;
  status: FulfillmentStatus;
  estimatedMinutes: number;
  notes?: string;
  receivedAt: string;
  preparingAt?: string;
  readyAt?: string;
  deliveredAt?: string;
  cancelledAt?: string;
  cancellationReason?: string;
}

export class MerchantOrderFulfillmentService {
  private key(merchantId: string): string {
    return `${PREFIX}${merchantId}`;
  }

  async list(merchantId: string): Promise<FulfillmentOrder[]> {
    const raw = await getRedis().get(this.key(merchantId));
    return raw ? JSON.parse(raw) : [];
  }

  async receive(input: {
    merchantId: string;
    customerId: string;
    customerName: string;
    items: OrderItem[];
    estimatedMinutes: number;
    notes?: string;
  }): Promise<FulfillmentOrder> {
    if (input.items.length === 0) throw new Error('Pedido sin items');
    if (input.items.length > 100) throw new Error('Maximo 100 items por pedido');
    if (input.estimatedMinutes < 0 || input.estimatedMinutes > 480) {
      throw new Error('Estimacion entre 0 y 480 minutos');
    }
    for (const item of input.items) {
      if (item.quantity < 1) throw new Error(`Cantidad invalida para ${item.name}`);
      if (item.unitPrice < 0) throw new Error(`Precio invalido para ${item.name}`);
    }
    const totalAmount = input.items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const list = await this.list(input.merchantId);
    const maxOrder = list.length > 0 ? Math.max(...list.map(o => o.orderNumber)) : 0;
    const order: FulfillmentOrder = {
      id: `ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      merchantId: input.merchantId,
      orderNumber: maxOrder + 1,
      customerId: input.customerId,
      customerName: input.customerName,
      items: input.items,
      totalAmount,
      status: 'RECEIVED',
      estimatedMinutes: input.estimatedMinutes,
      notes: input.notes,
      receivedAt: new Date().toISOString(),
    };
    list.push(order);
    if (list.length > 2000) list.splice(0, list.length - 2000);
    await getRedis().set(this.key(input.merchantId), JSON.stringify(list), { EX: TTL });
    log.info('order received', { id: order.id, orderNumber: order.orderNumber });
    return order;
  }

  async startPreparing(merchantId: string, id: string): Promise<FulfillmentOrder | null> {
    const list = await this.list(merchantId);
    const order = list.find(o => o.id === id);
    if (!order) return null;
    if (order.status !== 'RECEIVED') throw new Error('Solo se puede preparar pedidos recibidos');
    order.status = 'PREPARING';
    order.preparingAt = new Date().toISOString();
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return order;
  }

  async markReady(merchantId: string, id: string): Promise<FulfillmentOrder | null> {
    const list = await this.list(merchantId);
    const order = list.find(o => o.id === id);
    if (!order) return null;
    if (order.status !== 'PREPARING') throw new Error('Solo se puede marcar listo pedidos en preparacion');
    order.status = 'READY';
    order.readyAt = new Date().toISOString();
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return order;
  }

  async deliver(merchantId: string, id: string): Promise<FulfillmentOrder | null> {
    const list = await this.list(merchantId);
    const order = list.find(o => o.id === id);
    if (!order) return null;
    if (order.status !== 'READY') throw new Error('Solo se puede entregar pedidos listos');
    order.status = 'DELIVERED';
    order.deliveredAt = new Date().toISOString();
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return order;
  }

  async cancel(merchantId: string, id: string, reason: string): Promise<FulfillmentOrder | null> {
    const list = await this.list(merchantId);
    const order = list.find(o => o.id === id);
    if (!order) return null;
    if (order.status === 'DELIVERED') throw new Error('No se puede cancelar pedido entregado');
    if (order.status === 'CANCELLED') return order;
    order.status = 'CANCELLED';
    order.cancelledAt = new Date().toISOString();
    order.cancellationReason = reason;
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return order;
  }

  async getActive(merchantId: string): Promise<FulfillmentOrder[]> {
    const list = await this.list(merchantId);
    return list
      .filter(o => ['RECEIVED', 'PREPARING', 'READY'].includes(o.status))
      .sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime());
  }

  async getAverageTime(merchantId: string): Promise<{ preparingMinutes: number; totalMinutes: number; sampleSize: number }> {
    const list = await this.list(merchantId);
    const delivered = list.filter(o => o.status === 'DELIVERED' && o.preparingAt && o.readyAt && o.deliveredAt);
    if (delivered.length === 0) {
      return { preparingMinutes: 0, totalMinutes: 0, sampleSize: 0 };
    }
    const prepSum = delivered.reduce((s, o) => {
      const start = new Date(o.preparingAt!).getTime();
      const end = new Date(o.readyAt!).getTime();
      return s + (end - start) / 60000;
    }, 0);
    const totalSum = delivered.reduce((s, o) => {
      const start = new Date(o.receivedAt).getTime();
      const end = new Date(o.deliveredAt!).getTime();
      return s + (end - start) / 60000;
    }, 0);
    return {
      preparingMinutes: Math.round(prepSum / delivered.length),
      totalMinutes: Math.round(totalSum / delivered.length),
      sampleSize: delivered.length,
    };
  }

  async getDailyStats(merchantId: string, date: string): Promise<{
    received: number;
    delivered: number;
    cancelled: number;
    revenue: number;
  }> {
    const list = await this.list(merchantId);
    const dayOrders = list.filter(o => o.receivedAt.startsWith(date));
    const delivered = dayOrders.filter(o => o.status === 'DELIVERED');
    return {
      received: dayOrders.length,
      delivered: delivered.length,
      cancelled: dayOrders.filter(o => o.status === 'CANCELLED').length,
      revenue: delivered.reduce((s, o) => s + o.totalAmount, 0),
    };
  }
}

export const merchantOrderFulfillment = new MerchantOrderFulfillmentService();
