import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('platform-stats');
const PS_KEY = 'whatpay:platform:stats';
const PS_TTL = 60 * 60;

export interface PlatformStats {
  totalRegisteredUsers: number;
  totalActiveMerchants: number;
  totalTransactionsAllTime: number;
  totalVolumeAllTime: number;
  countries: string[];
  availableCurrencies: string[];
  apiVersion: string;
  servicesCount: number;
  testsCount: number;
  iterationsCount: number;
  lastDeployAt: string;
  updatedAt: string;
}

export class WhatPayPlatformStatsService {
  async getStats(): Promise<PlatformStats> {
    try {
      const redis = getRedis();
      const raw = await redis.get(PS_KEY);
      if (raw) return JSON.parse(raw) as PlatformStats;
    } catch { /* defaults */ }
    return this.defaults();
  }

  async updateStats(updates: Partial<PlatformStats>): Promise<PlatformStats> {
    const stats = await this.getStats();
    Object.assign(stats, updates);
    stats.updatedAt = new Date().toISOString();
    try { const redis = getRedis(); await redis.set(PS_KEY, JSON.stringify(stats), { EX: PS_TTL }); }
    catch (err) { log.warn('Failed to save platform stats', { error: (err as Error).message }); }
    return stats;
  }

  formatPlatformSummary(s: PlatformStats): string {
    return [
      '=== WhatPay Platform Stats ===',
      'Usuarios registrados: ' + s.totalRegisteredUsers.toLocaleString('es-CL'),
      'Comercios activos: ' + s.totalActiveMerchants.toLocaleString('es-CL'),
      'Transacciones (total): ' + s.totalTransactionsAllTime.toLocaleString('es-CL'),
      'Volumen (total): ' + formatCLP(s.totalVolumeAllTime),
      'Paises: ' + s.countries.join(', '),
      'Servicios: ' + s.servicesCount,
      'Tests: ' + s.testsCount,
      'Iteraciones: ' + s.iterationsCount,
      'Version API: ' + s.apiVersion,
    ].join('\n');
  }

  private defaults(): PlatformStats {
    return {
      totalRegisteredUsers: 0,
      totalActiveMerchants: 0,
      totalTransactionsAllTime: 0,
      totalVolumeAllTime: 0,
      countries: ['CL'],
      availableCurrencies: ['CLP', 'USD', 'PEN', 'ARS', 'COP', 'MXN', 'UF'],
      apiVersion: 'v1',
      servicesCount: 180,
      testsCount: 3200,
      iterationsCount: 250,
      lastDeployAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}

export const whatpayPlatformStats = new WhatPayPlatformStatsService();
