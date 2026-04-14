import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-cash-drop');
const PREFIX = 'merchant:cash-drop:';
const TTL = 180 * 24 * 60 * 60;

export type DropStatus = 'PENDING' | 'DEPOSITED' | 'LOST' | 'CANCELLED';

export interface CashDrop {
  id: string;
  merchantId: string;
  shiftId: string;
  employeeId: string;
  employeeName: string;
  amount: number;
  denominations: { value: number; count: number }[];
  safeLocation: string;
  witnessId?: string;
  status: DropStatus;
  createdAt: string;
  depositedAt?: string;
  bankReference?: string;
  notes?: string;
}

export class MerchantCashDropService {
  private key(merchantId: string): string {
    return `${PREFIX}${merchantId}`;
  }

  async list(merchantId: string): Promise<CashDrop[]> {
    const raw = await getRedis().get(this.key(merchantId));
    return raw ? JSON.parse(raw) : [];
  }

  private validateDenominations(denoms: { value: number; count: number }[], expected: number): number {
    let total = 0;
    for (const d of denoms) {
      if (d.count < 0) throw new Error('Cantidad no puede ser negativa');
      if (d.value <= 0) throw new Error('Denominacion invalida');
      total += d.value * d.count;
    }
    if (Math.abs(total - expected) > 1) {
      throw new Error(`Desglose ${total} no coincide con monto ${expected}`);
    }
    return total;
  }

  async recordDrop(input: {
    merchantId: string;
    shiftId: string;
    employeeId: string;
    employeeName: string;
    amount: number;
    denominations: { value: number; count: number }[];
    safeLocation: string;
    witnessId?: string;
    notes?: string;
  }): Promise<CashDrop> {
    if (input.amount <= 0) throw new Error('Monto debe ser positivo');
    if (input.amount > 50000000) throw new Error('Monto excede maximo permitido');
    if (!input.safeLocation) throw new Error('Ubicacion de caja fuerte requerida');
    this.validateDenominations(input.denominations, input.amount);
    const drop: CashDrop = {
      id: `drop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      merchantId: input.merchantId,
      shiftId: input.shiftId,
      employeeId: input.employeeId,
      employeeName: input.employeeName,
      amount: input.amount,
      denominations: input.denominations,
      safeLocation: input.safeLocation,
      witnessId: input.witnessId,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      notes: input.notes,
    };
    const list = await this.list(input.merchantId);
    list.push(drop);
    if (list.length > 2000) list.splice(0, list.length - 2000);
    await getRedis().set(this.key(input.merchantId), JSON.stringify(list), { EX: TTL });
    log.info('cash drop recorded', { id: drop.id, amount: drop.amount });
    return drop;
  }

  async markDeposited(merchantId: string, id: string, bankReference: string): Promise<CashDrop | null> {
    if (!bankReference) throw new Error('Referencia bancaria requerida');
    const list = await this.list(merchantId);
    const drop = list.find(d => d.id === id);
    if (!drop) return null;
    if (drop.status !== 'PENDING') throw new Error(`Drop ya en estado ${drop.status}`);
    drop.status = 'DEPOSITED';
    drop.depositedAt = new Date().toISOString();
    drop.bankReference = bankReference;
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return drop;
  }

  async markLost(merchantId: string, id: string, reason: string): Promise<CashDrop | null> {
    const list = await this.list(merchantId);
    const drop = list.find(d => d.id === id);
    if (!drop) return null;
    if (drop.status === 'DEPOSITED') throw new Error('No se puede marcar como perdido un drop depositado');
    drop.status = 'LOST';
    drop.notes = reason;
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    log.warn('cash drop marked lost', { id, amount: drop.amount });
    return drop;
  }

  async cancel(merchantId: string, id: string): Promise<CashDrop | null> {
    const list = await this.list(merchantId);
    const drop = list.find(d => d.id === id);
    if (!drop) return null;
    if (drop.status !== 'PENDING') throw new Error('Solo se puede cancelar drops pendientes');
    drop.status = 'CANCELLED';
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return drop;
  }

  async getPending(merchantId: string): Promise<CashDrop[]> {
    const list = await this.list(merchantId);
    return list
      .filter(d => d.status === 'PENDING')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  async getDailySummary(merchantId: string, date: string): Promise<{
    totalDropped: number;
    totalDeposited: number;
    pending: number;
    lost: number;
    dropCount: number;
  }> {
    const list = await this.list(merchantId);
    const dayDrops = list.filter(d => d.createdAt.startsWith(date));
    return {
      totalDropped: dayDrops.reduce((s, d) => s + d.amount, 0),
      totalDeposited: dayDrops.filter(d => d.status === 'DEPOSITED').reduce((s, d) => s + d.amount, 0),
      pending: dayDrops.filter(d => d.status === 'PENDING').length,
      lost: dayDrops.filter(d => d.status === 'LOST').length,
      dropCount: dayDrops.length,
    };
  }

  async getByEmployee(merchantId: string, employeeId: string): Promise<CashDrop[]> {
    const list = await this.list(merchantId);
    return list
      .filter(d => d.employeeId === employeeId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }
}

export const merchantCashDrop = new MerchantCashDropService();
