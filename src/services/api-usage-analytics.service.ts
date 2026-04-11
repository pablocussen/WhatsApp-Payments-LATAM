import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('api-usage');

const USAGE_PREFIX = 'apiusage:';
const USAGE_TTL = 90 * 24 * 60 * 60;

export interface EndpointStats {
  endpoint: string;
  method: string;
  requestCount: number;
  errorCount: number;
  avgResponseMs: number;
  totalResponseMs: number;
  rateLimitHits: number;
}

export interface UsageSummary {
  merchantId: string;
  period: string;
  totalRequests: number;
  totalErrors: number;
  errorRate: number;
  endpoints: EndpointStats[];
  rateLimitHits: number;
  updatedAt: string;
}

export class ApiUsageAnalyticsService {
  async recordRequest(merchantId: string, endpoint: string, method: string, responseMs: number, isError: boolean, rateLimited: boolean): Promise<void> {
    const dateKey = new Date().toISOString().slice(0, 10);
    const key = `${USAGE_PREFIX}${merchantId}:${dateKey}`;

    try {
      const redis = getRedis();
      const raw = await redis.get(key);
      const summary: UsageSummary = raw ? JSON.parse(raw) : {
        merchantId, period: dateKey, totalRequests: 0, totalErrors: 0,
        errorRate: 0, endpoints: [], rateLimitHits: 0, updatedAt: '',
      };

      summary.totalRequests++;
      if (isError) summary.totalErrors++;
      if (rateLimited) summary.rateLimitHits++;
      summary.errorRate = summary.totalRequests > 0 ? Math.round((summary.totalErrors / summary.totalRequests) * 100) : 0;

      let ep = summary.endpoints.find(e => e.endpoint === endpoint && e.method === method);
      if (!ep) {
        ep = { endpoint, method, requestCount: 0, errorCount: 0, avgResponseMs: 0, totalResponseMs: 0, rateLimitHits: 0 };
        summary.endpoints.push(ep);
      }
      ep.requestCount++;
      if (isError) ep.errorCount++;
      if (rateLimited) ep.rateLimitHits++;
      ep.totalResponseMs += responseMs;
      ep.avgResponseMs = Math.round(ep.totalResponseMs / ep.requestCount);

      summary.updatedAt = new Date().toISOString();
      await redis.set(key, JSON.stringify(summary), { EX: USAGE_TTL });
    } catch (err) {
      log.warn('Failed to record usage', { merchantId, error: (err as Error).message });
    }
  }

  async getDailySummary(merchantId: string, date?: string): Promise<UsageSummary | null> {
    const dateKey = date ?? new Date().toISOString().slice(0, 10);
    try {
      const redis = getRedis();
      const raw = await redis.get(`${USAGE_PREFIX}${merchantId}:${dateKey}`);
      return raw ? JSON.parse(raw) as UsageSummary : null;
    } catch {
      return null;
    }
  }

  async getTopEndpoints(merchantId: string, date?: string, limit = 5): Promise<EndpointStats[]> {
    const summary = await this.getDailySummary(merchantId, date);
    if (!summary) return [];
    return summary.endpoints.sort((a, b) => b.requestCount - a.requestCount).slice(0, limit);
  }

  hasHighErrorRate(summary: UsageSummary): boolean {
    return summary.errorRate > 5;
  }

  formatSummary(summary: UsageSummary): string {
    const warn = this.hasHighErrorRate(summary) ? ' [ALERTA: Error rate alto]' : '';
    return [
      `Período: ${summary.period}`,
      `Requests: ${summary.totalRequests}`,
      `Errores: ${summary.totalErrors} (${summary.errorRate}%)${warn}`,
      `Rate limit hits: ${summary.rateLimitHits}`,
      `Endpoints: ${summary.endpoints.length}`,
    ].join(' | ');
  }
}

export const apiUsageAnalytics = new ApiUsageAnalyticsService();
