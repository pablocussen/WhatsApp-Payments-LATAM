import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('merchant-dashboard');

const DASH_PREFIX = 'mdash:';
const DASH_TTL = 5 * 60; // 5 min cache

export interface DashboardMetrics {
  merchantId: string;
  today: { revenue: number; transactions: number; customers: number; avgTicket: number };
  week: { revenue: number; transactions: number; customers: number; avgTicket: number };
  month: { revenue: number; transactions: number; customers: number; avgTicket: number };
  topProducts: { name: string; count: number; revenue: number }[];
  recentTransactions: { ref: string; amount: number; customer: string; time: string }[];
  alerts: { type: string; message: string }[];
  updatedAt: string;
}

export class MerchantDashboardService {
  async getMetrics(merchantId: string): Promise<DashboardMetrics> {
    try {
      const redis = getRedis();
      const cached = await redis.get(`${DASH_PREFIX}${merchantId}`);
      if (cached) return JSON.parse(cached) as DashboardMetrics;
    } catch { /* compute */ }

    // Return default/empty metrics
    const empty = { revenue: 0, transactions: 0, customers: 0, avgTicket: 0 };
    return {
      merchantId,
      today: { ...empty },
      week: { ...empty },
      month: { ...empty },
      topProducts: [],
      recentTransactions: [],
      alerts: [],
      updatedAt: new Date().toISOString(),
    };
  }

  async updateMetrics(merchantId: string, metrics: Omit<DashboardMetrics, 'merchantId' | 'updatedAt'>): Promise<DashboardMetrics> {
    const dashboard: DashboardMetrics = {
      merchantId,
      ...metrics,
      updatedAt: new Date().toISOString(),
    };

    try {
      const redis = getRedis();
      await redis.set(`${DASH_PREFIX}${merchantId}`, JSON.stringify(dashboard), { EX: DASH_TTL });
    } catch (err) {
      log.warn('Failed to cache dashboard', { merchantId, error: (err as Error).message });
    }

    return dashboard;
  }

  async addAlert(merchantId: string, type: string, message: string): Promise<void> {
    const metrics = await this.getMetrics(merchantId);
    metrics.alerts.push({ type, message });
    if (metrics.alerts.length > 10) metrics.alerts = metrics.alerts.slice(-10);

    try {
      const redis = getRedis();
      await redis.set(`${DASH_PREFIX}${merchantId}`, JSON.stringify(metrics), { EX: DASH_TTL });
    } catch (err) {
      log.warn('Failed to add alert', { merchantId, error: (err as Error).message });
    }
  }

  async clearAlerts(merchantId: string): Promise<void> {
    const metrics = await this.getMetrics(merchantId);
    metrics.alerts = [];

    try {
      const redis = getRedis();
      await redis.set(`${DASH_PREFIX}${merchantId}`, JSON.stringify(metrics), { EX: DASH_TTL });
    } catch (err) {
      log.warn('Failed to clear alerts', { merchantId, error: (err as Error).message });
    }
  }

  formatSummary(m: DashboardMetrics): string {
    return [
      `Hoy: ${formatCLP(m.today.revenue)} (${m.today.transactions} tx)`,
      `Semana: ${formatCLP(m.week.revenue)} (${m.week.transactions} tx)`,
      `Mes: ${formatCLP(m.month.revenue)} (${m.month.transactions} tx)`,
      m.alerts.length > 0 ? `${m.alerts.length} alerta(s) pendiente(s)` : 'Sin alertas',
    ].join('\n');
  }

  calculateGrowth(current: number, previous: number): { pct: number; direction: 'up' | 'down' | 'flat' } {
    if (previous === 0) return { pct: 0, direction: 'flat' };
    const pct = Math.round(((current - previous) / previous) * 100);
    return { pct: Math.abs(pct), direction: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat' };
  }
}

export const merchantDashboard = new MerchantDashboardService();
