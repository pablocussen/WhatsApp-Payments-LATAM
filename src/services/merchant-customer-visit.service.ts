import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-customer-visit');
const PREFIX = 'merchant:customer-visit:';
const TTL = 180 * 24 * 60 * 60;

export interface CustomerVisit {
  id: string;
  merchantId: string;
  customerId: string;
  customerName: string;
  visitedAt: string;
  amountSpent: number;
  itemsPurchased: number;
  source: 'WALK_IN' | 'QR_SCAN' | 'ORDER' | 'RESERVATION';
  notes?: string;
}

export interface CustomerSummary {
  customerId: string;
  customerName: string;
  visitCount: number;
  totalSpent: number;
  averageTicket: number;
  firstVisit: string;
  lastVisit: string;
  daysSinceLastVisit: number;
}

export class MerchantCustomerVisitService {
  private key(merchantId: string): string {
    return `${PREFIX}${merchantId}`;
  }

  async list(merchantId: string): Promise<CustomerVisit[]> {
    const raw = await getRedis().get(this.key(merchantId));
    return raw ? JSON.parse(raw) : [];
  }

  async recordVisit(input: {
    merchantId: string;
    customerId: string;
    customerName: string;
    amountSpent: number;
    itemsPurchased: number;
    source: 'WALK_IN' | 'QR_SCAN' | 'ORDER' | 'RESERVATION';
    notes?: string;
  }): Promise<CustomerVisit> {
    if (input.amountSpent < 0) throw new Error('Monto no puede ser negativo');
    if (input.itemsPurchased < 0) throw new Error('Items no puede ser negativo');
    if (input.customerName.length > 80) throw new Error('Nombre excede 80 caracteres');
    const visit: CustomerVisit = {
      id: `visit_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      merchantId: input.merchantId,
      customerId: input.customerId,
      customerName: input.customerName,
      visitedAt: new Date().toISOString(),
      amountSpent: input.amountSpent,
      itemsPurchased: input.itemsPurchased,
      source: input.source,
      notes: input.notes,
    };
    const list = await this.list(input.merchantId);
    list.push(visit);
    if (list.length > 10000) list.splice(0, list.length - 10000);
    await getRedis().set(this.key(input.merchantId), JSON.stringify(list), { EX: TTL });
    log.info('visit recorded', { merchantId: input.merchantId, customerId: input.customerId });
    return visit;
  }

  async getCustomerHistory(merchantId: string, customerId: string): Promise<CustomerVisit[]> {
    const list = await this.list(merchantId);
    return list
      .filter(v => v.customerId === customerId)
      .sort((a, b) => new Date(b.visitedAt).getTime() - new Date(a.visitedAt).getTime());
  }

  async getCustomerSummary(merchantId: string, customerId: string): Promise<CustomerSummary | null> {
    const visits = await this.getCustomerHistory(merchantId, customerId);
    if (visits.length === 0) return null;
    const totalSpent = visits.reduce((s, v) => s + v.amountSpent, 0);
    const sorted = [...visits].sort((a, b) => new Date(a.visitedAt).getTime() - new Date(b.visitedAt).getTime());
    const lastVisitMs = new Date(sorted[sorted.length - 1].visitedAt).getTime();
    return {
      customerId,
      customerName: visits[0].customerName,
      visitCount: visits.length,
      totalSpent,
      averageTicket: Math.round(totalSpent / visits.length),
      firstVisit: sorted[0].visitedAt,
      lastVisit: sorted[sorted.length - 1].visitedAt,
      daysSinceLastVisit: Math.floor((Date.now() - lastVisitMs) / 86400000),
    };
  }

  async getTopCustomers(merchantId: string, limit = 10): Promise<CustomerSummary[]> {
    const list = await this.list(merchantId);
    const byCustomer = new Map<string, CustomerVisit[]>();
    for (const v of list) {
      const arr = byCustomer.get(v.customerId) ?? [];
      arr.push(v);
      byCustomer.set(v.customerId, arr);
    }
    const summaries: CustomerSummary[] = [];
    for (const [customerId, visits] of byCustomer.entries()) {
      const totalSpent = visits.reduce((s, v) => s + v.amountSpent, 0);
      const sorted = [...visits].sort((a, b) => new Date(a.visitedAt).getTime() - new Date(b.visitedAt).getTime());
      summaries.push({
        customerId,
        customerName: visits[0].customerName,
        visitCount: visits.length,
        totalSpent,
        averageTicket: Math.round(totalSpent / visits.length),
        firstVisit: sorted[0].visitedAt,
        lastVisit: sorted[sorted.length - 1].visitedAt,
        daysSinceLastVisit: Math.floor((Date.now() - new Date(sorted[sorted.length - 1].visitedAt).getTime()) / 86400000),
      });
    }
    return summaries
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, limit);
  }

  async getLapsed(merchantId: string, dayThreshold = 30): Promise<CustomerSummary[]> {
    const top = await this.getTopCustomers(merchantId, 1000);
    return top.filter(c => c.daysSinceLastVisit >= dayThreshold);
  }

  async getBySource(merchantId: string, days: number): Promise<Record<string, number>> {
    const list = await this.list(merchantId);
    const cutoff = Date.now() - days * 86400000;
    const counts: Record<string, number> = { WALK_IN: 0, QR_SCAN: 0, ORDER: 0, RESERVATION: 0 };
    for (const v of list) {
      if (new Date(v.visitedAt).getTime() < cutoff) continue;
      counts[v.source]++;
    }
    return counts;
  }
}

export const merchantCustomerVisit = new MerchantCustomerVisitService();
