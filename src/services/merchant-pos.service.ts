import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('merchant-pos');
const POS_PREFIX = 'mpos:';
const POS_TTL = 365 * 24 * 60 * 60;
const MAX_POS = 10;

export interface POSTerminal {
  id: string;
  merchantId: string;
  name: string;
  location: string;
  active: boolean;
  totalTransactions: number;
  totalVolume: number;
  lastTransactionAt: string | null;
  createdAt: string;
}

export class MerchantPOSService {
  async createTerminal(merchantId: string, name: string, location: string): Promise<POSTerminal> {
    if (!name) throw new Error('Nombre requerido.');
    const terminals = await this.getTerminals(merchantId);
    if (terminals.length >= MAX_POS) throw new Error('Maximo 10 terminales.');
    const terminal: POSTerminal = {
      id: `pos_${Date.now().toString(36)}`, merchantId, name, location,
      active: true, totalTransactions: 0, totalVolume: 0,
      lastTransactionAt: null, createdAt: new Date().toISOString(),
    };
    terminals.push(terminal);
    await this.save(merchantId, terminals);
    return terminal;
  }

  async getTerminals(merchantId: string): Promise<POSTerminal[]> {
    try { const redis = getRedis(); const raw = await redis.get(`${POS_PREFIX}${merchantId}`); return raw ? JSON.parse(raw) as POSTerminal[] : []; }
    catch { return []; }
  }

  async recordTransaction(merchantId: string, posId: string, amount: number): Promise<boolean> {
    const terminals = await this.getTerminals(merchantId);
    const pos = terminals.find(t => t.id === posId && t.active);
    if (!pos) return false;
    pos.totalTransactions++; pos.totalVolume += amount; pos.lastTransactionAt = new Date().toISOString();
    await this.save(merchantId, terminals);
    return true;
  }

  async deactivateTerminal(merchantId: string, posId: string): Promise<boolean> {
    const terminals = await this.getTerminals(merchantId);
    const pos = terminals.find(t => t.id === posId);
    if (!pos) return false;
    pos.active = false;
    await this.save(merchantId, terminals);
    return true;
  }

  getTerminalSummary(pos: POSTerminal): string {
    return `${pos.name} (${pos.location}): ${pos.totalTransactions} tx, ${formatCLP(pos.totalVolume)}${pos.active ? '' : ' [INACTIVO]'}`;
  }

  private async save(merchantId: string, terminals: POSTerminal[]): Promise<void> {
    try { const redis = getRedis(); await redis.set(`${POS_PREFIX}${merchantId}`, JSON.stringify(terminals), { EX: POS_TTL }); }
    catch (err) { log.warn('Failed to save POS', { merchantId, error: (err as Error).message }); }
  }
}

export const merchantPOS = new MerchantPOSService();
