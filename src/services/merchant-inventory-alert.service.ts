import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('inventory-alert');
const IA_PREFIX = 'minvalert:';
const IA_TTL = 365 * 24 * 60 * 60;

export interface InventoryAlert {
  id: string;
  merchantId: string;
  productId: string;
  productName: string;
  threshold: number;
  currentStock: number;
  triggered: boolean;
  notifiedAt: string | null;
  createdAt: string;
}

export class MerchantInventoryAlertService {
  async setAlert(merchantId: string, productId: string, productName: string, threshold: number): Promise<InventoryAlert> {
    if (threshold < 1) throw new Error('Umbral debe ser al menos 1.');
    const alert: InventoryAlert = {
      id: `ia_${Date.now().toString(36)}`, merchantId, productId, productName,
      threshold, currentStock: 0, triggered: false, notifiedAt: null,
      createdAt: new Date().toISOString(),
    };
    try { const redis = getRedis(); await redis.set(`${IA_PREFIX}${merchantId}:${productId}`, JSON.stringify(alert), { EX: IA_TTL }); }
    catch (err) { log.warn('Failed to save inventory alert', { error: (err as Error).message }); }
    return alert;
  }

  async checkStock(merchantId: string, productId: string, currentStock: number): Promise<{ shouldAlert: boolean; alert: InventoryAlert | null }> {
    const alert = await this.getAlert(merchantId, productId);
    if (!alert) return { shouldAlert: false, alert: null };
    alert.currentStock = currentStock;
    const shouldAlert = currentStock <= alert.threshold && !alert.triggered;
    if (shouldAlert) { alert.triggered = true; alert.notifiedAt = new Date().toISOString(); }
    try { const redis = getRedis(); await redis.set(`${IA_PREFIX}${merchantId}:${productId}`, JSON.stringify(alert), { EX: IA_TTL }); }
    catch { /* ignore */ }
    return { shouldAlert, alert };
  }

  async getAlert(merchantId: string, productId: string): Promise<InventoryAlert | null> {
    try { const redis = getRedis(); const raw = await redis.get(`${IA_PREFIX}${merchantId}:${productId}`); return raw ? JSON.parse(raw) as InventoryAlert : null; }
    catch { return null; }
  }

  async resetAlert(merchantId: string, productId: string): Promise<boolean> {
    const alert = await this.getAlert(merchantId, productId);
    if (!alert) return false;
    alert.triggered = false; alert.notifiedAt = null;
    try { const redis = getRedis(); await redis.set(`${IA_PREFIX}${merchantId}:${productId}`, JSON.stringify(alert), { EX: IA_TTL }); }
    catch { return false; }
    return true;
  }
}

export const merchantInventoryAlert = new MerchantInventoryAlertService();
