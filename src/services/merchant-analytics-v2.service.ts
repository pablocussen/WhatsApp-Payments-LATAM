import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('merchant-analytics-v2');
const MA2_PREFIX = 'manav2:';
const MA2_TTL = 90 * 24 * 60 * 60;

export interface HourlyStats {
  hour: number;
  transactions: number;
  revenue: number;
}

export interface DayStats {
  date: string;
  transactions: number;
  revenue: number;
  uniqueCustomers: number;
  topHour: number;
}

export class MerchantAnalyticsV2Service {
  async recordHour(merchantId: string, date: string, hour: number, revenue: number): Promise<void> {
    if (hour < 0 || hour > 23) throw new Error('Hora invalida.');
    const key = `${MA2_PREFIX}${merchantId}:${date}`;
    try {
      const redis = getRedis();
      const raw = await redis.get(key);
      const stats: Record<number, HourlyStats> = raw ? JSON.parse(raw) : {};
      if (!stats[hour]) stats[hour] = { hour, transactions: 0, revenue: 0 };
      stats[hour].transactions++;
      stats[hour].revenue += revenue;
      await redis.set(key, JSON.stringify(stats), { EX: MA2_TTL });
    } catch (err) { log.warn('Failed to record hour', { error: (err as Error).message }); }
  }

  async getHourlyBreakdown(merchantId: string, date: string): Promise<HourlyStats[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${MA2_PREFIX}${merchantId}:${date}`);
      if (!raw) return [];
      const stats = JSON.parse(raw) as Record<number, HourlyStats>;
      return Object.values(stats).sort((a, b) => a.hour - b.hour);
    } catch { return []; }
  }

  async getPeakHour(merchantId: string, date: string): Promise<HourlyStats | null> {
    const hourly = await this.getHourlyBreakdown(merchantId, date);
    if (hourly.length === 0) return null;
    return hourly.reduce((max, h) => h.revenue > max.revenue ? h : max);
  }

  async getQuietHour(merchantId: string, date: string): Promise<HourlyStats | null> {
    const hourly = await this.getHourlyBreakdown(merchantId, date);
    if (hourly.length === 0) return null;
    return hourly.reduce((min, h) => h.revenue < min.revenue ? h : min);
  }

  formatHourlyChart(hourly: HourlyStats[]): string {
    if (hourly.length === 0) return 'Sin datos para este dia.';
    const max = Math.max(...hourly.map(h => h.revenue));
    return hourly.map(h => {
      const barLen = Math.round((h.revenue / max) * 20);
      const bar = 'â–ˆ'.repeat(barLen) + 'â–‘'.repeat(20 - barLen);
      return `${h.hour.toString().padStart(2, '0')}:00 ${bar} ${formatCLP(h.revenue)}`;
    }).join('\n');
  }
}

export const merchantAnalyticsV2 = new MerchantAnalyticsV2Service();
