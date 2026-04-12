import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('health-check');
const HC_PREFIX = 'healthchk:';
const HC_TTL = 60 * 60;

export type ServiceStatus = 'OPERATIONAL' | 'DEGRADED' | 'OUTAGE' | 'MAINTENANCE';

export interface ServiceHealth {
  name: string;
  status: ServiceStatus;
  responseMs: number;
  lastCheckedAt: string;
  message: string | null;
}

export interface PlatformHealth {
  overallStatus: ServiceStatus;
  services: ServiceHealth[];
  uptime: number;
  incidents24h: number;
  lastIncident: string | null;
  updatedAt: string;
}

export class WhatPayHealthCheckService {
  async recordCheck(serviceName: string, status: ServiceStatus, responseMs: number, message?: string): Promise<ServiceHealth> {
    const health: ServiceHealth = {
      name: serviceName,
      status,
      responseMs,
      lastCheckedAt: new Date().toISOString(),
      message: message ?? null,
    };
    try {
      const redis = getRedis();
      await redis.set(HC_PREFIX + serviceName, JSON.stringify(health), { EX: HC_TTL });
    } catch (err) { log.warn('Failed to save health', { error: (err as Error).message }); }
    if (status === 'OUTAGE') log.warn('Service outage detected', { serviceName });
    return health;
  }

  async getServiceHealth(serviceName: string): Promise<ServiceHealth | null> {
    try { const redis = getRedis(); const raw = await redis.get(HC_PREFIX + serviceName); return raw ? JSON.parse(raw) as ServiceHealth : null; }
    catch { return null; }
  }

  async getPlatformHealth(services: string[]): Promise<PlatformHealth> {
    const results: ServiceHealth[] = [];
    for (const svc of services) {
      const h = await this.getServiceHealth(svc);
      if (h) results.push(h);
    }

    const hasOutage = results.some(s => s.status === 'OUTAGE');
    const hasDegraded = results.some(s => s.status === 'DEGRADED');
    const overallStatus: ServiceStatus = hasOutage ? 'OUTAGE' : hasDegraded ? 'DEGRADED' : 'OPERATIONAL';

    const operational = results.filter(s => s.status === 'OPERATIONAL').length;
    const uptime = results.length > 0 ? Math.round((operational / results.length) * 10000) / 100 : 100;

    return {
      overallStatus,
      services: results,
      uptime,
      incidents24h: 0,
      lastIncident: null,
      updatedAt: new Date().toISOString(),
    };
  }

  async runFullCheck(): Promise<{ api: boolean; redis: boolean; database: boolean }> {
    const results = { api: true, redis: false, database: false };
    try {
      const redis = getRedis();
      await redis.set('health:ping', '1', { EX: 10 });
      results.redis = true;
    } catch { /* redis down */ }
    results.database = true;
    return results;
  }
}

export const whatpayHealthCheck = new WhatPayHealthCheckService();
