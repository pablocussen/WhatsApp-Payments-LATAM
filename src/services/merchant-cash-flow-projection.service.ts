import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-cash-flow-projection');
const PREFIX = 'merchant:cash-flow:';
const TTL = 90 * 24 * 60 * 60;

export type EntryType = 'INCOME' | 'EXPENSE';
export type RecurringInterval = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface CashFlowEntry {
  id: string;
  merchantId: string;
  type: EntryType;
  category: string;
  amount: number;
  date: string;
  recurring: boolean;
  recurringInterval?: RecurringInterval;
  note?: string;
  createdAt: string;
}

export interface Projection {
  days: number;
  expectedIncome: number;
  expectedExpense: number;
  netCashFlow: number;
  endingBalance: number;
}

export class MerchantCashFlowProjectionService {
  private key(merchantId: string): string {
    return `${PREFIX}${merchantId}`;
  }

  async list(merchantId: string): Promise<CashFlowEntry[]> {
    const raw = await getRedis().get(this.key(merchantId));
    return raw ? JSON.parse(raw) : [];
  }

  async addEntry(input: {
    merchantId: string;
    type: EntryType;
    category: string;
    amount: number;
    date: string;
    recurring?: boolean;
    recurringInterval?: RecurringInterval;
    note?: string;
  }): Promise<CashFlowEntry> {
    if (input.amount <= 0) throw new Error('Monto debe ser positivo');
    if (input.category.length > 50) throw new Error('Categoria excede 50 caracteres');
    if (isNaN(new Date(input.date).getTime())) throw new Error('Fecha invalida');
    if (input.recurring && !input.recurringInterval) {
      throw new Error('Entrada recurrente requiere intervalo');
    }
    const list = await this.list(input.merchantId);
    if (list.length >= 500) throw new Error('Maximo 500 entradas de flujo');
    const entry: CashFlowEntry = {
      id: `cfe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      merchantId: input.merchantId,
      type: input.type,
      category: input.category,
      amount: input.amount,
      date: input.date,
      recurring: input.recurring ?? false,
      recurringInterval: input.recurringInterval,
      note: input.note,
      createdAt: new Date().toISOString(),
    };
    list.push(entry);
    await getRedis().set(this.key(input.merchantId), JSON.stringify(list), { EX: TTL });
    log.info('cash flow entry added', { id: entry.id, type: entry.type });
    return entry;
  }

  async removeEntry(merchantId: string, id: string): Promise<boolean> {
    const list = await this.list(merchantId);
    const idx = list.findIndex(e => e.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return true;
  }

  private occurrencesInWindow(entry: CashFlowEntry, fromMs: number, toMs: number): number {
    const entryMs = new Date(entry.date).getTime();
    if (!entry.recurring) {
      return entryMs >= fromMs && entryMs <= toMs ? 1 : 0;
    }
    if (entryMs > toMs) return 0;
    const intervalMs = entry.recurringInterval === 'DAILY' ? 86400000
      : entry.recurringInterval === 'WEEKLY' ? 7 * 86400000
      : 30 * 86400000;
    let count = 0;
    let cursor = entryMs;
    while (cursor <= toMs) {
      if (cursor >= fromMs) count++;
      cursor += intervalMs;
    }
    return count;
  }

  async project(merchantId: string, days: number, currentBalance: number): Promise<Projection> {
    if (days < 1 || days > 365) throw new Error('Dias entre 1 y 365');
    const list = await this.list(merchantId);
    const now = Date.now();
    const cutoff = now + days * 86400000;
    let expectedIncome = 0;
    let expectedExpense = 0;
    for (const entry of list) {
      const occ = this.occurrencesInWindow(entry, now, cutoff);
      const total = entry.amount * occ;
      if (entry.type === 'INCOME') expectedIncome += total;
      else expectedExpense += total;
    }
    const netCashFlow = expectedIncome - expectedExpense;
    return {
      days,
      expectedIncome,
      expectedExpense,
      netCashFlow,
      endingBalance: currentBalance + netCashFlow,
    };
  }

  async getByCategory(merchantId: string, type: EntryType): Promise<Record<string, number>> {
    const list = await this.list(merchantId);
    const totals: Record<string, number> = {};
    for (const e of list.filter(x => x.type === type)) {
      totals[e.category] = (totals[e.category] ?? 0) + e.amount;
    }
    return totals;
  }

  async getRunway(merchantId: string, currentBalance: number): Promise<number> {
    const list = await this.list(merchantId);
    let monthlyIncome = 0;
    let monthlyExpense = 0;
    for (const entry of list) {
      if (!entry.recurring) continue;
      const multiplier = entry.recurringInterval === 'DAILY' ? 30
        : entry.recurringInterval === 'WEEKLY' ? 4.33
        : 1;
      if (entry.type === 'INCOME') monthlyIncome += entry.amount * multiplier;
      else monthlyExpense += entry.amount * multiplier;
    }
    const monthlyBurn = monthlyExpense - monthlyIncome;
    if (monthlyBurn <= 0) return Infinity;
    return Math.round((currentBalance / monthlyBurn) * 10) / 10;
  }
}

export const merchantCashFlowProjection = new MerchantCashFlowProjectionService();
