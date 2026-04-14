import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-sales-forecast');
const PREFIX = 'merchant:sales-forecast:';
const TTL = 90 * 24 * 60 * 60;

export interface DailySales {
  date: string;
  totalSales: number;
  transactionCount: number;
}

export interface Forecast {
  date: string;
  predictedSales: number;
  predictedTransactions: number;
  confidenceLevel: 'LOW' | 'MEDIUM' | 'HIGH';
}

export interface HistoryStore {
  merchantId: string;
  history: DailySales[];
  updatedAt: string;
}

export class MerchantSalesForecastService {
  private key(merchantId: string): string {
    return `${PREFIX}${merchantId}`;
  }

  async get(merchantId: string): Promise<HistoryStore> {
    const raw = await getRedis().get(this.key(merchantId));
    if (raw) return JSON.parse(raw);
    return { merchantId, history: [], updatedAt: new Date().toISOString() };
  }

  async addDailySales(merchantId: string, entry: DailySales): Promise<HistoryStore> {
    if (entry.totalSales < 0) throw new Error('Ventas no pueden ser negativas');
    if (entry.transactionCount < 0) throw new Error('Transacciones no pueden ser negativas');
    if (isNaN(new Date(entry.date).getTime())) throw new Error('Fecha invalida');
    const store = await this.get(merchantId);
    const existingIdx = store.history.findIndex(h => h.date === entry.date);
    if (existingIdx >= 0) {
      store.history[existingIdx] = entry;
    } else {
      store.history.push(entry);
    }
    store.history.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    if (store.history.length > 365) {
      store.history = store.history.slice(-365);
    }
    store.updatedAt = new Date().toISOString();
    await getRedis().set(this.key(merchantId), JSON.stringify(store), { EX: TTL });
    log.info('daily sales added', { merchantId, date: entry.date });
    return store;
  }

  private getDayOfWeek(dateStr: string): number {
    return new Date(dateStr).getUTCDay();
  }

  async forecastNextDays(merchantId: string, days: number): Promise<Forecast[]> {
    if (days < 1 || days > 30) throw new Error('Dias entre 1 y 30');
    const store = await this.get(merchantId);
    if (store.history.length < 7) {
      throw new Error('Se requieren al menos 7 dias de historial');
    }
    const byDayOfWeek: Record<number, { sales: number[]; tx: number[] }> = {};
    for (const h of store.history) {
      const dow = this.getDayOfWeek(h.date);
      if (!byDayOfWeek[dow]) byDayOfWeek[dow] = { sales: [], tx: [] };
      byDayOfWeek[dow].sales.push(h.totalSales);
      byDayOfWeek[dow].tx.push(h.transactionCount);
    }
    const confidenceLevel: 'LOW' | 'MEDIUM' | 'HIGH' =
      store.history.length >= 60 ? 'HIGH' : store.history.length >= 30 ? 'MEDIUM' : 'LOW';
    const forecasts: Forecast[] = [];
    for (let i = 1; i <= days; i++) {
      const futureDate = new Date(Date.now() + i * 86400000);
      const dow = futureDate.getUTCDay();
      const data = byDayOfWeek[dow];
      if (!data || data.sales.length === 0) {
        const allSales = store.history.map(h => h.totalSales);
        const allTx = store.history.map(h => h.transactionCount);
        forecasts.push({
          date: futureDate.toISOString().split('T')[0],
          predictedSales: Math.round(allSales.reduce((s, v) => s + v, 0) / allSales.length),
          predictedTransactions: Math.round(allTx.reduce((s, v) => s + v, 0) / allTx.length),
          confidenceLevel: 'LOW',
        });
        continue;
      }
      const avgSales = data.sales.reduce((s, v) => s + v, 0) / data.sales.length;
      const avgTx = data.tx.reduce((s, v) => s + v, 0) / data.tx.length;
      forecasts.push({
        date: futureDate.toISOString().split('T')[0],
        predictedSales: Math.round(avgSales),
        predictedTransactions: Math.round(avgTx),
        confidenceLevel,
      });
    }
    return forecasts;
  }

  async getTrend(merchantId: string): Promise<'UP' | 'DOWN' | 'FLAT'> {
    const store = await this.get(merchantId);
    if (store.history.length < 14) return 'FLAT';
    const recent = store.history.slice(-7);
    const previous = store.history.slice(-14, -7);
    const recentAvg = recent.reduce((s, h) => s + h.totalSales, 0) / 7;
    const previousAvg = previous.reduce((s, h) => s + h.totalSales, 0) / 7;
    const delta = (recentAvg - previousAvg) / (previousAvg || 1);
    if (delta > 0.1) return 'UP';
    if (delta < -0.1) return 'DOWN';
    return 'FLAT';
  }

  async getBestDay(merchantId: string): Promise<{ dayOfWeek: number; avgSales: number } | null> {
    const store = await this.get(merchantId);
    if (store.history.length === 0) return null;
    const byDow: Record<number, number[]> = {};
    for (const h of store.history) {
      const dow = this.getDayOfWeek(h.date);
      if (!byDow[dow]) byDow[dow] = [];
      byDow[dow].push(h.totalSales);
    }
    let bestDow = 0;
    let bestAvg = 0;
    for (const [dow, sales] of Object.entries(byDow)) {
      const avg = sales.reduce((s, v) => s + v, 0) / sales.length;
      if (avg > bestAvg) {
        bestAvg = avg;
        bestDow = Number(dow);
      }
    }
    return { dayOfWeek: bestDow, avgSales: Math.round(bestAvg) };
  }
}

export const merchantSalesForecast = new MerchantSalesForecastService();
