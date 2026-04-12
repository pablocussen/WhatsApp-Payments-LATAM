import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('cash-drawer');
const CD_PREFIX = 'cdrawer:';
const CD_TTL = 90 * 24 * 60 * 60;

export type DrawerStatus = 'OPEN' | 'CLOSED';
export type MovementType = 'IN' | 'OUT' | 'SALE' | 'REFUND' | 'WITHDRAWAL' | 'DEPOSIT';

export interface CashMovement {
  type: MovementType;
  amount: number;
  reason: string;
  timestamp: string;
}

export interface CashDrawer {
  id: string;
  merchantId: string;
  posId: string;
  openingBalance: number;
  currentBalance: number;
  expectedBalance: number;
  movements: CashMovement[];
  status: DrawerStatus;
  openedAt: string;
  closedAt: string | null;
  closingDifference: number | null;
}

export class MerchantCashDrawerService {
  async openDrawer(merchantId: string, posId: string, openingBalance: number): Promise<CashDrawer> {
    if (openingBalance < 0) throw new Error('Saldo inicial debe ser positivo.');
    const drawer: CashDrawer = {
      id: 'drwr_' + Date.now().toString(36),
      merchantId, posId, openingBalance,
      currentBalance: openingBalance,
      expectedBalance: openingBalance,
      movements: [],
      status: 'OPEN',
      openedAt: new Date().toISOString(),
      closedAt: null,
      closingDifference: null,
    };
    try { const redis = getRedis(); await redis.set(CD_PREFIX + drawer.id, JSON.stringify(drawer), { EX: CD_TTL }); }
    catch (err) { log.warn('Failed to open drawer', { error: (err as Error).message }); }
    return drawer;
  }

  async addMovement(drawerId: string, type: MovementType, amount: number, reason: string): Promise<boolean> {
    const drawer = await this.getDrawer(drawerId);
    if (!drawer || drawer.status !== 'OPEN') return false;
    if (amount <= 0) throw new Error('Monto debe ser positivo.');

    const inFlow = type === 'IN' || type === 'SALE' || type === 'DEPOSIT';
    const delta = inFlow ? amount : -amount;
    drawer.currentBalance += delta;
    drawer.expectedBalance += delta;
    drawer.movements.push({ type, amount, reason, timestamp: new Date().toISOString() });

    try { const redis = getRedis(); await redis.set(CD_PREFIX + drawerId, JSON.stringify(drawer), { EX: CD_TTL }); }
    catch { return false; }
    return true;
  }

  async closeDrawer(drawerId: string, countedAmount: number): Promise<CashDrawer | null> {
    const drawer = await this.getDrawer(drawerId);
    if (!drawer || drawer.status !== 'OPEN') return null;
    drawer.status = 'CLOSED';
    drawer.closedAt = new Date().toISOString();
    drawer.closingDifference = countedAmount - drawer.expectedBalance;
    drawer.currentBalance = countedAmount;
    try { const redis = getRedis(); await redis.set(CD_PREFIX + drawerId, JSON.stringify(drawer), { EX: CD_TTL }); }
    catch { return null; }
    log.info('Drawer closed', { drawerId, difference: drawer.closingDifference });
    return drawer;
  }

  async getDrawer(drawerId: string): Promise<CashDrawer | null> {
    try { const redis = getRedis(); const raw = await redis.get(CD_PREFIX + drawerId); return raw ? JSON.parse(raw) as CashDrawer : null; }
    catch { return null; }
  }

  formatDrawerSummary(d: CashDrawer): string {
    const diff = d.closingDifference;
    const diffStr = diff === null ? '' : diff === 0 ? ' (cuadra)' : diff > 0 ? ' (sobra ' + formatCLP(diff) + ')' : ' (falta ' + formatCLP(Math.abs(diff)) + ')';
    return d.id + ': ' + formatCLP(d.currentBalance) + ' — ' + d.movements.length + ' movs — ' + d.status + diffStr;
  }
}

export const merchantCashDrawer = new MerchantCashDrawerService();
