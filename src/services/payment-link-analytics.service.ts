import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('link-analytics');
const LA_PREFIX = 'linkana:';
const LA_TTL = 180 * 24 * 60 * 60;

export interface LinkAnalytics {
  linkId: string;
  merchantId: string;
  views: number;
  uniqueVisitors: number;
  payments: number;
  totalCollected: number;
  conversionRate: number;
  avgPaymentTime: number;
  topReferrers: { source: string; count: number }[];
  createdAt: string;
  updatedAt: string;
}

export class PaymentLinkAnalyticsService {
  async recordView(linkId: string, merchantId: string, visitorId: string): Promise<void> {
    const analytics = await this.getAnalytics(linkId, merchantId);
    analytics.views++;
    if (!analytics.topReferrers.some(r => r.source === visitorId)) {
      analytics.uniqueVisitors++;
    }
    analytics.conversionRate = analytics.views > 0 ? Math.round((analytics.payments / analytics.views) * 100) : 0;
    analytics.updatedAt = new Date().toISOString();
    await this.save(linkId, merchantId, analytics);
  }

  async recordPayment(linkId: string, merchantId: string, amount: number): Promise<void> {
    const analytics = await this.getAnalytics(linkId, merchantId);
    analytics.payments++;
    analytics.totalCollected += amount;
    analytics.conversionRate = analytics.views > 0 ? Math.round((analytics.payments / analytics.views) * 100) : 0;
    analytics.updatedAt = new Date().toISOString();
    await this.save(linkId, merchantId, analytics);
  }

  async getAnalytics(linkId: string, merchantId: string): Promise<LinkAnalytics> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${LA_PREFIX}${linkId}`);
      if (raw) return JSON.parse(raw) as LinkAnalytics;
    } catch { /* defaults */ }
    return {
      linkId, merchantId, views: 0, uniqueVisitors: 0, payments: 0,
      totalCollected: 0, conversionRate: 0, avgPaymentTime: 0,
      topReferrers: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
  }

  formatSummary(a: LinkAnalytics): string {
    return `Link ${a.linkId}: ${a.views} vistas, ${a.payments} pagos (${a.conversionRate}%), ${formatCLP(a.totalCollected)} recaudado`;
  }

  private async save(linkId: string, merchantId: string, analytics: LinkAnalytics): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${LA_PREFIX}${linkId}`, JSON.stringify(analytics), { EX: LA_TTL });
    } catch (err) {
      log.warn('Failed to save link analytics', { linkId, error: (err as Error).message });
    }
  }
}

export const paymentLinkAnalytics = new PaymentLinkAnalyticsService();
