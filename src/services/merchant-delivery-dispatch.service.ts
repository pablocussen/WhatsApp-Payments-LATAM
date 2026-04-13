import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-delivery-dispatch');
const PREFIX = 'merchant:delivery-dispatch:';
const TTL = 90 * 24 * 60 * 60;

export type DispatchStatus = 'PENDING' | 'ASSIGNED' | 'IN_TRANSIT' | 'DELIVERED' | 'FAILED' | 'CANCELLED';

export interface Dispatch {
  id: string;
  merchantId: string;
  orderId: string;
  customerName: string;
  customerPhone: string;
  address: string;
  latitude?: number;
  longitude?: number;
  courierId?: string;
  courierName?: string;
  status: DispatchStatus;
  amount: number;
  createdAt: string;
  assignedAt?: string;
  pickedUpAt?: string;
  deliveredAt?: string;
  failureReason?: string;
  proofImageUrl?: string;
}

export class MerchantDeliveryDispatchService {
  private key(merchantId: string): string {
    return `${PREFIX}${merchantId}`;
  }

  async list(merchantId: string): Promise<Dispatch[]> {
    const raw = await getRedis().get(this.key(merchantId));
    return raw ? JSON.parse(raw) : [];
  }

  async createDispatch(input: {
    merchantId: string;
    orderId: string;
    customerName: string;
    customerPhone: string;
    address: string;
    amount: number;
    latitude?: number;
    longitude?: number;
  }): Promise<Dispatch> {
    if (input.amount <= 0) throw new Error('Monto debe ser positivo');
    if (!/^\+?[0-9]{8,15}$/.test(input.customerPhone)) throw new Error('Telefono invalido');
    if (input.address.length < 5 || input.address.length > 200) {
      throw new Error('Direccion debe tener entre 5 y 200 caracteres');
    }
    const list = await this.list(input.merchantId);
    if (list.some(d => d.orderId === input.orderId && d.status !== 'CANCELLED')) {
      throw new Error('Ya existe dispatch activo para esta orden');
    }
    const dispatch: Dispatch = {
      id: `disp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      merchantId: input.merchantId,
      orderId: input.orderId,
      customerName: input.customerName,
      customerPhone: input.customerPhone,
      address: input.address,
      latitude: input.latitude,
      longitude: input.longitude,
      status: 'PENDING',
      amount: input.amount,
      createdAt: new Date().toISOString(),
    };
    list.push(dispatch);
    if (list.length > 500) list.splice(0, list.length - 500);
    await getRedis().set(this.key(input.merchantId), JSON.stringify(list), { EX: TTL });
    log.info('dispatch created', { id: dispatch.id });
    return dispatch;
  }

  async assignCourier(merchantId: string, dispatchId: string, courierId: string, courierName: string): Promise<Dispatch | null> {
    const list = await this.list(merchantId);
    const d = list.find(x => x.id === dispatchId);
    if (!d) return null;
    if (d.status !== 'PENDING') throw new Error(`No se puede asignar, estado actual: ${d.status}`);
    d.courierId = courierId;
    d.courierName = courierName;
    d.status = 'ASSIGNED';
    d.assignedAt = new Date().toISOString();
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return d;
  }

  async markInTransit(merchantId: string, dispatchId: string): Promise<Dispatch | null> {
    const list = await this.list(merchantId);
    const d = list.find(x => x.id === dispatchId);
    if (!d) return null;
    if (d.status !== 'ASSIGNED') throw new Error('Debe estar asignado primero');
    d.status = 'IN_TRANSIT';
    d.pickedUpAt = new Date().toISOString();
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return d;
  }

  async markDelivered(merchantId: string, dispatchId: string, proofImageUrl?: string): Promise<Dispatch | null> {
    const list = await this.list(merchantId);
    const d = list.find(x => x.id === dispatchId);
    if (!d) return null;
    if (d.status !== 'IN_TRANSIT') throw new Error('Debe estar en transito');
    d.status = 'DELIVERED';
    d.deliveredAt = new Date().toISOString();
    if (proofImageUrl) d.proofImageUrl = proofImageUrl;
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return d;
  }

  async markFailed(merchantId: string, dispatchId: string, reason: string): Promise<Dispatch | null> {
    const list = await this.list(merchantId);
    const d = list.find(x => x.id === dispatchId);
    if (!d) return null;
    if (d.status === 'DELIVERED' || d.status === 'CANCELLED') {
      throw new Error('No se puede fallar un dispatch finalizado');
    }
    d.status = 'FAILED';
    d.failureReason = reason;
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return d;
  }

  async getByStatus(merchantId: string, status: DispatchStatus): Promise<Dispatch[]> {
    const list = await this.list(merchantId);
    return list.filter(d => d.status === status);
  }

  async getCourierLoad(merchantId: string, courierId: string): Promise<number> {
    const list = await this.list(merchantId);
    return list.filter(d => d.courierId === courierId && (d.status === 'ASSIGNED' || d.status === 'IN_TRANSIT')).length;
  }

  async getDeliveryStats(merchantId: string): Promise<{ total: number; delivered: number; failed: number; successRate: number; avgDeliveryMinutes: number }> {
    const list = await this.list(merchantId);
    const total = list.length;
    const delivered = list.filter(d => d.status === 'DELIVERED');
    const failed = list.filter(d => d.status === 'FAILED').length;
    const avgMs = delivered.length > 0
      ? delivered.reduce((sum, d) => {
          if (!d.assignedAt || !d.deliveredAt) return sum;
          return sum + (new Date(d.deliveredAt).getTime() - new Date(d.assignedAt).getTime());
        }, 0) / delivered.length
      : 0;
    return {
      total,
      delivered: delivered.length,
      failed,
      successRate: total > 0 ? Math.round((delivered.length / total) * 100) : 0,
      avgDeliveryMinutes: Math.round(avgMs / 60000),
    };
  }
}

export const merchantDeliveryDispatch = new MerchantDeliveryDispatchService();
