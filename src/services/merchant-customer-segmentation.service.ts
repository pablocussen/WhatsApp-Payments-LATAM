import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('customer-segmentation');
const CS_PREFIX = 'cseg:';
const CS_TTL = 90 * 24 * 60 * 60;

export type SegmentType = 'NEW' | 'ACTIVE' | 'VIP' | 'INACTIVE' | 'CHURNED';

export interface CustomerSegment {
  type: SegmentType;
  name: string;
  description: string;
  count: number;
  totalSpent: number;
  avgTicket: number;
}

export class MerchantCustomerSegmentationService {
  segmentCustomer(daysSinceLastTx: number, totalSpent: number, transactionCount: number): SegmentType {
    if (transactionCount === 0) return 'NEW';
    if (daysSinceLastTx > 90) return 'CHURNED';
    if (daysSinceLastTx > 30) return 'INACTIVE';
    if (totalSpent >= 500000 && transactionCount >= 10) return 'VIP';
    return 'ACTIVE';
  }

  async saveSegmentation(merchantId: string, segments: Record<SegmentType, CustomerSegment>): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(CS_PREFIX + merchantId, JSON.stringify(segments), { EX: CS_TTL });
    } catch (err) { log.warn('Failed to save segmentation', { error: (err as Error).message }); }
  }

  async getSegmentation(merchantId: string): Promise<Record<SegmentType, CustomerSegment> | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(CS_PREFIX + merchantId);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  buildEmptySegments(): Record<SegmentType, CustomerSegment> {
    return {
      NEW: { type: 'NEW', name: 'Nuevos', description: 'Sin transacciones aun', count: 0, totalSpent: 0, avgTicket: 0 },
      ACTIVE: { type: 'ACTIVE', name: 'Activos', description: 'Compraron en los ultimos 30 dias', count: 0, totalSpent: 0, avgTicket: 0 },
      VIP: { type: 'VIP', name: 'VIP', description: '$500K+ y 10+ transacciones', count: 0, totalSpent: 0, avgTicket: 0 },
      INACTIVE: { type: 'INACTIVE', name: 'Inactivos', description: 'Sin compras 30-90 dias', count: 0, totalSpent: 0, avgTicket: 0 },
      CHURNED: { type: 'CHURNED', name: 'Perdidos', description: 'Mas de 90 dias sin compras', count: 0, totalSpent: 0, avgTicket: 0 },
    };
  }
}

export const merchantCustomerSegmentation = new MerchantCustomerSegmentationService();
