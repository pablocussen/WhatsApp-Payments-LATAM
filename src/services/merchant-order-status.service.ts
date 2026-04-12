import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('order-status');
const OS_PREFIX = 'ordstat:';
const OS_TTL = 90 * 24 * 60 * 60;

export type OrderStatus = 'PENDING' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED';

export interface OrderStatusUpdate {
  status: OrderStatus;
  notes: string | null;
  timestamp: string;
  updatedBy: string;
}

export interface OrderTracking {
  orderId: string;
  merchantId: string;
  customerPhone: string;
  currentStatus: OrderStatus;
  history: OrderStatusUpdate[];
  estimatedDelivery: string | null;
  createdAt: string;
}

const STATUS_FLOW: Record<OrderStatus, OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['OUT_FOR_DELIVERY', 'DELIVERED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

export class MerchantOrderStatusService {
  async createOrder(input: { orderId: string; merchantId: string; customerPhone: string; estimatedDelivery?: string }): Promise<OrderTracking> {
    const tracking: OrderTracking = {
      orderId: input.orderId,
      merchantId: input.merchantId,
      customerPhone: input.customerPhone,
      currentStatus: 'PENDING',
      history: [{ status: 'PENDING', notes: 'Pedido creado', timestamp: new Date().toISOString(), updatedBy: 'SYSTEM' }],
      estimatedDelivery: input.estimatedDelivery ?? null,
      createdAt: new Date().toISOString(),
    };
    try { const redis = getRedis(); await redis.set(OS_PREFIX + input.orderId, JSON.stringify(tracking), { EX: OS_TTL }); }
    catch (err) { log.warn('Failed to save tracking', { error: (err as Error).message }); }
    return tracking;
  }

  async updateStatus(orderId: string, newStatus: OrderStatus, updatedBy: string, notes?: string): Promise<{ success: boolean; error?: string }> {
    const tracking = await this.getOrder(orderId);
    if (!tracking) return { success: false, error: 'Pedido no encontrado.' };
    const allowed = STATUS_FLOW[tracking.currentStatus];
    if (!allowed.includes(newStatus)) {
      return { success: false, error: 'Transicion invalida de ' + tracking.currentStatus + ' a ' + newStatus };
    }

    tracking.currentStatus = newStatus;
    tracking.history.push({ status: newStatus, notes: notes ?? null, timestamp: new Date().toISOString(), updatedBy });
    try { const redis = getRedis(); await redis.set(OS_PREFIX + orderId, JSON.stringify(tracking), { EX: OS_TTL }); }
    catch { return { success: false, error: 'Error al guardar.' }; }
    log.info('Order status updated', { orderId, newStatus });
    return { success: true };
  }

  async getOrder(orderId: string): Promise<OrderTracking | null> {
    try { const redis = getRedis(); const raw = await redis.get(OS_PREFIX + orderId); return raw ? JSON.parse(raw) as OrderTracking : null; }
    catch { return null; }
  }

  isTerminal(status: OrderStatus): boolean {
    return status === 'DELIVERED' || status === 'CANCELLED';
  }

  getAllowedTransitions(current: OrderStatus): OrderStatus[] {
    return STATUS_FLOW[current] ?? [];
  }
}

export const merchantOrderStatus = new MerchantOrderStatusService();
