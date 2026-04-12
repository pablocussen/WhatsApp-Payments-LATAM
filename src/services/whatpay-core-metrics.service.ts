import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('core-metrics');
const METRICS_KEY = 'whatpay:core:metrics';
const METRICS_TTL = 24 * 60 * 60; // 1 day cache

export interface CoreMetrics {
  totalUsers: number;
  activeUsers30d: number;
  totalMerchants: number;
  activeMerchants30d: number;
  totalTransactions: number;
  totalVolume: number;
  avgTicket: number;
  mau: number;
  dau: number;
  mrr: number;
  platformUptime: number;
  avgResponseMs: number;
  updatedAt: string;
}

export class WhatPayCoreMetricsService {
  async getMetrics(): Promise<CoreMetrics> {
    try {
      const redis = getRedis();
      const raw = await redis.get(METRICS_KEY);
      if (raw) return JSON.parse(raw) as CoreMetrics;
    } catch { /* defaults */ }
    return this.empty();
  }

  async updateMetrics(input: Omit<CoreMetrics, 'updatedAt' | 'avgTicket'>): Promise<CoreMetrics> {
    const avgTicket = input.totalTransactions > 0 ? Math.round(input.totalVolume / input.totalTransactions) : 0;
    const metrics: CoreMetrics = { ...input, avgTicket, updatedAt: new Date().toISOString() };
    try {
      const redis = getRedis();
      await redis.set(METRICS_KEY, JSON.stringify(metrics), { EX: METRICS_TTL });
    } catch (err) { log.warn('Failed to save core metrics', { error: (err as Error).message }); }
    log.info('Core metrics updated', { totalUsers: input.totalUsers, mau: input.mau });
    return metrics;
  }

  async incrementUsers(delta = 1): Promise<void> {
    const metrics = await this.getMetrics();
    metrics.totalUsers += delta;
    await this.updateMetrics({ ...metrics });
  }

  async incrementTransactions(count: number, volume: number): Promise<void> {
    const metrics = await this.getMetrics();
    metrics.totalTransactions += count;
    metrics.totalVolume += volume;
    await this.updateMetrics({ ...metrics });
  }

  formatDashboard(m: CoreMetrics): string {
    return [
      '=== WhatPay Core Metrics ===',
      `Usuarios: ${m.totalUsers.toLocaleString('es-CL')} (MAU: ${m.mau}, DAU: ${m.dau})`,
      `Merchants: ${m.totalMerchants.toLocaleString('es-CL')} (activos 30d: ${m.activeMerchants30d})`,
      `Transacciones: ${m.totalTransactions.toLocaleString('es-CL')}`,
      `Volumen total: ${formatCLP(m.totalVolume)}`,
      `Ticket promedio: ${formatCLP(m.avgTicket)}`,
      `MRR: ${formatCLP(m.mrr)}`,
      `Uptime: ${m.platformUptime}%`,
      `Latencia API: ${m.avgResponseMs}ms`,
    ].join('\n');
  }

  calculateEngagement(m: CoreMetrics): { dauMauRatio: number; stickiness: string } {
    const ratio = m.mau > 0 ? Math.round((m.dau / m.mau) * 100) : 0;
    const stickiness = ratio >= 50 ? 'Excelente' : ratio >= 30 ? 'Bueno' : ratio >= 15 ? 'Regular' : 'Bajo';
    return { dauMauRatio: ratio, stickiness };
  }

  private empty(): CoreMetrics {
    return {
      totalUsers: 0, activeUsers30d: 0, totalMerchants: 0, activeMerchants30d: 0,
      totalTransactions: 0, totalVolume: 0, avgTicket: 0,
      mau: 0, dau: 0, mrr: 0, platformUptime: 100, avgResponseMs: 0,
      updatedAt: new Date().toISOString(),
    };
  }
}

export const whatpayCoreMetrics = new WhatPayCoreMetricsService();
