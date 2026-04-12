import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('live-counter');
const LC_PREFIX = 'livecnt:';
const LC_TTL = 24 * 60 * 60;

export interface LiveCounter {
  merchantId: string;
  todayTransactions: number;
  todayRevenue: number;
  activeCustomersNow: number;
  lastTransactionAt: string | null;
  updatedAt: string;
}

export class MerchantLiveCounterService {
  async incrementTransaction(merchantId: string, amount: number): Promise<LiveCounter> {
    const counter = await this.getCounter(merchantId);
    counter.todayTransactions++;
    counter.todayRevenue += amount;
    counter.lastTransactionAt = new Date().toISOString();
    counter.updatedAt = new Date().toISOString();
    await this.save(counter);
    return counter;
  }

  async setActiveCustomers(merchantId: string, count: number): Promise<void> {
    const counter = await this.getCounter(merchantId);
    counter.activeCustomersNow = count;
    counter.updatedAt = new Date().toISOString();
    await this.save(counter);
  }

  async getCounter(merchantId: string): Promise<LiveCounter> {
    try {
      const redis = getRedis();
      const raw = await redis.get(LC_PREFIX + merchantId);
      if (raw) return JSON.parse(raw) as LiveCounter;
    } catch { /* defaults */ }
    return {
      merchantId, todayTransactions: 0, todayRevenue: 0,
      activeCustomersNow: 0, lastTransactionAt: null,
      updatedAt: new Date().toISOString(),
    };
  }

  async resetDaily(merchantId: string): Promise<void> {
    const counter = await this.getCounter(merchantId);
    counter.todayTransactions = 0;
    counter.todayRevenue = 0;
    counter.updatedAt = new Date().toISOString();
    await this.save(counter);
  }

  formatLiveSummary(c: LiveCounter): string {
    const avg = c.todayTransactions > 0 ? Math.round(c.todayRevenue / c.todayTransactions) : 0;
    return [
      'Hoy: ' + c.todayTransactions + ' tx, ' + formatCLP(c.todayRevenue),
      'Ticket promedio: ' + formatCLP(avg),
      'Clientes activos: ' + c.activeCustomersNow,
    ].join(' | ');
  }

  private async save(counter: LiveCounter): Promise<void> {
    try { const redis = getRedis(); await redis.set(LC_PREFIX + counter.merchantId, JSON.stringify(counter), { EX: LC_TTL }); }
    catch (err) { log.warn('Failed to save counter', { error: (err as Error).message }); }
  }
}

export const merchantLiveCounter = new MerchantLiveCounterService();
