import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('campaign-perf');
const CP_PREFIX = 'campperf:';
const CP_TTL = 180 * 24 * 60 * 60;

export interface CampaignMetrics {
  campaignId: string;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue: number;
  cost: number;
  updatedAt: string;
}

export class MerchantCampaignPerformanceService {
  async trackImpression(campaignId: string): Promise<void> {
    const metrics = await this.getMetrics(campaignId);
    metrics.impressions++;
    metrics.updatedAt = new Date().toISOString();
    await this.save(metrics);
  }

  async trackClick(campaignId: string): Promise<void> {
    const metrics = await this.getMetrics(campaignId);
    metrics.clicks++;
    metrics.updatedAt = new Date().toISOString();
    await this.save(metrics);
  }

  async trackConversion(campaignId: string, revenue: number): Promise<void> {
    const metrics = await this.getMetrics(campaignId);
    metrics.conversions++;
    metrics.revenue += revenue;
    metrics.updatedAt = new Date().toISOString();
    await this.save(metrics);
  }

  async setCost(campaignId: string, cost: number): Promise<void> {
    const metrics = await this.getMetrics(campaignId);
    metrics.cost = cost;
    metrics.updatedAt = new Date().toISOString();
    await this.save(metrics);
  }

  async getMetrics(campaignId: string): Promise<CampaignMetrics> {
    try {
      const redis = getRedis();
      const raw = await redis.get(CP_PREFIX + campaignId);
      if (raw) return JSON.parse(raw) as CampaignMetrics;
    } catch { /* defaults */ }
    return { campaignId, impressions: 0, clicks: 0, conversions: 0, revenue: 0, cost: 0, updatedAt: new Date().toISOString() };
  }

  calculateCTR(m: CampaignMetrics): number {
    return m.impressions > 0 ? Math.round((m.clicks / m.impressions) * 10000) / 100 : 0;
  }

  calculateConversionRate(m: CampaignMetrics): number {
    return m.clicks > 0 ? Math.round((m.conversions / m.clicks) * 10000) / 100 : 0;
  }

  calculateROI(m: CampaignMetrics): number {
    if (m.cost === 0) return 0;
    return Math.round(((m.revenue - m.cost) / m.cost) * 100);
  }

  calculateROAS(m: CampaignMetrics): number {
    if (m.cost === 0) return 0;
    return Math.round((m.revenue / m.cost) * 100) / 100;
  }

  formatMetricsSummary(m: CampaignMetrics): string {
    return [
      m.impressions + ' impresiones, ' + m.clicks + ' clicks (CTR ' + this.calculateCTR(m) + '%)',
      m.conversions + ' conversiones (' + this.calculateConversionRate(m) + '%)',
      'Revenue: ' + formatCLP(m.revenue) + ', Cost: ' + formatCLP(m.cost),
      'ROI: ' + this.calculateROI(m) + '%, ROAS: ' + this.calculateROAS(m) + 'x',
    ].join('\n');
  }

  private async save(metrics: CampaignMetrics): Promise<void> {
    try { const redis = getRedis(); await redis.set(CP_PREFIX + metrics.campaignId, JSON.stringify(metrics), { EX: CP_TTL }); }
    catch (err) { log.warn('Failed to save metrics', { error: (err as Error).message }); }
  }
}

export const merchantCampaignPerformance = new MerchantCampaignPerformanceService();
