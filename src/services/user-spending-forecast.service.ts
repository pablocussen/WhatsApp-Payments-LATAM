import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('spending-forecast');
const SF_PREFIX = 'spforecast:';
const SF_TTL = 7 * 24 * 60 * 60;

export interface SpendingForecast {
  userId: string;
  currentMonthSpent: number;
  daysElapsed: number;
  projectedMonthEnd: number;
  avgDailySpend: number;
  vsLastMonth: number;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  generatedAt: string;
}

export class UserSpendingForecastService {
  async generateForecast(userId: string, currentMonthSpent: number, lastMonthTotal: number): Promise<SpendingForecast> {
    const now = new Date();
    const daysElapsed = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const avgDailySpend = daysElapsed > 0 ? Math.round(currentMonthSpent / daysElapsed) : 0;
    const projectedMonthEnd = avgDailySpend * daysInMonth;
    const vsLastMonth = lastMonthTotal > 0
      ? Math.round(((projectedMonthEnd - lastMonthTotal) / lastMonthTotal) * 100)
      : 0;

    const confidence: SpendingForecast['confidence'] =
      daysElapsed >= 15 ? 'HIGH' : daysElapsed >= 7 ? 'MEDIUM' : 'LOW';

    const forecast: SpendingForecast = {
      userId, currentMonthSpent, daysElapsed,
      projectedMonthEnd, avgDailySpend, vsLastMonth, confidence,
      generatedAt: new Date().toISOString(),
    };

    try { const redis = getRedis(); await redis.set(SF_PREFIX + userId, JSON.stringify(forecast), { EX: SF_TTL }); }
    catch (err) { log.warn('Failed to save forecast', { error: (err as Error).message }); }
    return forecast;
  }

  async getForecast(userId: string): Promise<SpendingForecast | null> {
    try { const redis = getRedis(); const raw = await redis.get(SF_PREFIX + userId); return raw ? JSON.parse(raw) as SpendingForecast : null; }
    catch { return null; }
  }

  formatForecast(f: SpendingForecast): string {
    const trend = f.vsLastMonth > 0 ? 'mas' : f.vsLastMonth < 0 ? 'menos' : 'igual';
    return [
      'Proyeccion fin de mes: ' + formatCLP(f.projectedMonthEnd),
      'Promedio diario: ' + formatCLP(f.avgDailySpend),
      'vs mes pasado: ' + Math.abs(f.vsLastMonth) + '% ' + trend,
      'Confianza: ' + f.confidence,
    ].join('\n');
  }
}

export const userSpendingForecast = new UserSpendingForecastService();
