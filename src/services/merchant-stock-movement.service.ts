import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('stock-movement');
const SM_PREFIX = 'stockmov:';
const SM_TTL = 90 * 24 * 60 * 60;
const MAX_LOG = 500;

export type MovementReason = 'SALE' | 'PURCHASE' | 'RETURN' | 'ADJUSTMENT' | 'LOSS' | 'TRANSFER';

export interface StockMovement {
  id: string;
  productId: string;
  merchantId: string;
  type: 'IN' | 'OUT';
  reason: MovementReason;
  quantity: number;
  previousStock: number;
  newStock: number;
  notes: string | null;
  createdBy: string;
  createdAt: string;
}

export class MerchantStockMovementService {
  async recordMovement(input: {
    merchantId: string; productId: string; reason: MovementReason;
    quantity: number; previousStock: number; createdBy: string; notes?: string;
  }): Promise<StockMovement> {
    if (input.quantity === 0) throw new Error('Cantidad debe ser distinta de 0.');

    const isOut = ['SALE', 'LOSS', 'TRANSFER'].includes(input.reason);
    const type = isOut ? 'OUT' : 'IN';
    const delta = isOut ? -Math.abs(input.quantity) : Math.abs(input.quantity);
    const newStock = input.previousStock + delta;
    if (newStock < 0) throw new Error('Stock no puede ser negativo.');

    const movement: StockMovement = {
      id: 'mov_' + Date.now().toString(36),
      productId: input.productId,
      merchantId: input.merchantId,
      type,
      reason: input.reason,
      quantity: Math.abs(input.quantity),
      previousStock: input.previousStock,
      newStock,
      notes: input.notes ?? null,
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
    };

    try {
      const redis = getRedis();
      await redis.lPush(SM_PREFIX + input.merchantId + ':' + input.productId, JSON.stringify(movement));
      await redis.lTrim(SM_PREFIX + input.merchantId + ':' + input.productId, 0, MAX_LOG - 1);
      await redis.expire(SM_PREFIX + input.merchantId + ':' + input.productId, SM_TTL);
    } catch (err) { log.warn('Failed to record movement', { error: (err as Error).message }); }

    log.info('Stock movement', { productId: input.productId, type, quantity: input.quantity });
    return movement;
  }

  async getMovements(merchantId: string, productId: string, limit = 50): Promise<StockMovement[]> {
    try {
      const redis = getRedis();
      const raw = await redis.lRange(SM_PREFIX + merchantId + ':' + productId, 0, limit - 1);
      return raw.map(r => JSON.parse(r) as StockMovement);
    } catch { return []; }
  }

  async getStockSummary(merchantId: string, productId: string): Promise<{ totalIn: number; totalOut: number; netChange: number }> {
    const movements = await this.getMovements(merchantId, productId, MAX_LOG);
    const totalIn = movements.filter(m => m.type === 'IN').reduce((s, m) => s + m.quantity, 0);
    const totalOut = movements.filter(m => m.type === 'OUT').reduce((s, m) => s + m.quantity, 0);
    return { totalIn, totalOut, netChange: totalIn - totalOut };
  }
}

export const merchantStockMovement = new MerchantStockMovementService();
