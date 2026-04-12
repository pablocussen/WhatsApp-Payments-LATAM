import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('inv-forecast');
const IF_PREFIX = 'invforecast:';
const IF_TTL = 30 * 24 * 60 * 60;

export interface InventoryForecast {
  productId: string;
  merchantId: string;
  currentStock: number;
  avgDailySales: number;
  daysUntilStockout: number;
  recommendedReorder: number;
  reorderBy: string;
  urgency: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  generatedAt: string;
}

export class MerchantInventoryForecastService {
  async generateForecast(merchantId: string, productId: string, currentStock: number, salesLast30Days: number, leadTimeDays: number = 7): Promise<InventoryForecast> {
    const avgDailySales = salesLast30Days / 30;
    const daysUntilStockout = avgDailySales > 0 ? Math.floor(currentStock / avgDailySales) : Infinity;
    const recommendedReorder = Math.ceil(avgDailySales * (leadTimeDays + 14));
    const daysToAdd = daysUntilStockout === Infinity ? 365 : Math.max(0, daysUntilStockout - leadTimeDays);
    const reorderBy = new Date(Date.now() + daysToAdd * 24 * 60 * 60 * 1000).toISOString();

    let urgency: InventoryForecast['urgency'];
    if (daysUntilStockout <= leadTimeDays) urgency = 'CRITICAL';
    else if (daysUntilStockout <= leadTimeDays * 2) urgency = 'HIGH';
    else if (daysUntilStockout <= leadTimeDays * 4) urgency = 'MEDIUM';
    else urgency = 'LOW';

    const forecast: InventoryForecast = {
      productId, merchantId, currentStock, avgDailySales,
      daysUntilStockout: daysUntilStockout === Infinity ? 9999 : daysUntilStockout,
      recommendedReorder, reorderBy, urgency,
      generatedAt: new Date().toISOString(),
    };
    try { const redis = getRedis(); await redis.set(IF_PREFIX + merchantId + ':' + productId, JSON.stringify(forecast), { EX: IF_TTL }); }
    catch (err) { log.warn('Failed to save forecast', { error: (err as Error).message }); }
    return forecast;
  }

  async getForecast(merchantId: string, productId: string): Promise<InventoryForecast | null> {
    try { const redis = getRedis(); const raw = await redis.get(IF_PREFIX + merchantId + ':' + productId); return raw ? JSON.parse(raw) as InventoryForecast : null; }
    catch { return null; }
  }
}

export const merchantInventoryForecast = new MerchantInventoryForecastService();
