import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('merchant-shift');
const SH_PREFIX = 'mshift:';
const SH_TTL = 90 * 24 * 60 * 60;

export type ShiftStatus = 'OPEN' | 'CLOSED';

export interface Shift {
  id: string;
  merchantId: string;
  cashierId: string;
  cashierName: string;
  openingAmount: number;
  closingAmount: number | null;
  totalCash: number;
  totalDigital: number;
  transactionCount: number;
  status: ShiftStatus;
  openedAt: string;
  closedAt: string | null;
}

export class MerchantShiftService {
  async openShift(input: { merchantId: string; cashierId: string; cashierName: string; openingAmount: number }): Promise<Shift> {
    if (input.openingAmount < 0) throw new Error('Monto inicial debe ser positivo.');
    const active = await this.getActiveShift(input.merchantId, input.cashierId);
    if (active) throw new Error('Ya existe un turno abierto para este cajero.');

    const shift: Shift = {
      id: `shift_${Date.now().toString(36)}`, merchantId: input.merchantId,
      cashierId: input.cashierId, cashierName: input.cashierName,
      openingAmount: input.openingAmount, closingAmount: null,
      totalCash: 0, totalDigital: 0, transactionCount: 0,
      status: 'OPEN', openedAt: new Date().toISOString(), closedAt: null,
    };
    try {
      const redis = getRedis();
      await redis.set(`${SH_PREFIX}${shift.id}`, JSON.stringify(shift), { EX: SH_TTL });
      await redis.set(`${SH_PREFIX}active:${input.merchantId}:${input.cashierId}`, shift.id, { EX: SH_TTL });
    } catch (err) { log.warn('Failed to open shift', { error: (err as Error).message }); }
    log.info('Shift opened', { shiftId: shift.id, cashierId: input.cashierId });
    return shift;
  }

  async recordTransaction(shiftId: string, amount: number, isCash: boolean): Promise<boolean> {
    const shift = await this.getShift(shiftId);
    if (!shift || shift.status !== 'OPEN') return false;
    if (isCash) shift.totalCash += amount;
    else shift.totalDigital += amount;
    shift.transactionCount++;
    try { const redis = getRedis(); await redis.set(`${SH_PREFIX}${shiftId}`, JSON.stringify(shift), { EX: SH_TTL }); }
    catch { return false; }
    return true;
  }

  async closeShift(shiftId: string, closingAmount: number): Promise<Shift | null> {
    const shift = await this.getShift(shiftId);
    if (!shift || shift.status !== 'OPEN') return null;
    shift.status = 'CLOSED';
    shift.closingAmount = closingAmount;
    shift.closedAt = new Date().toISOString();
    try {
      const redis = getRedis();
      await redis.set(`${SH_PREFIX}${shiftId}`, JSON.stringify(shift), { EX: SH_TTL });
      await redis.del(`${SH_PREFIX}active:${shift.merchantId}:${shift.cashierId}`);
    } catch { return null; }
    log.info('Shift closed', { shiftId, total: shift.totalCash + shift.totalDigital });
    return shift;
  }

  async getShift(shiftId: string): Promise<Shift | null> {
    try { const redis = getRedis(); const raw = await redis.get(`${SH_PREFIX}${shiftId}`); return raw ? JSON.parse(raw) as Shift : null; }
    catch { return null; }
  }

  async getActiveShift(merchantId: string, cashierId: string): Promise<Shift | null> {
    try {
      const redis = getRedis();
      const id = await redis.get(`${SH_PREFIX}active:${merchantId}:${cashierId}`);
      return id ? this.getShift(id) : null;
    } catch { return null; }
  }

  calculateDiscrepancy(shift: Shift): number {
    if (shift.closingAmount === null) return 0;
    const expected = shift.openingAmount + shift.totalCash;
    return shift.closingAmount - expected;
  }

  formatShiftSummary(shift: Shift): string {
    const total = shift.totalCash + shift.totalDigital;
    const discrepancy = this.calculateDiscrepancy(shift);
    const discStr = discrepancy === 0 ? 'cuadra' : discrepancy > 0 ? `sobra ${formatCLP(discrepancy)}` : `falta ${formatCLP(Math.abs(discrepancy))}`;
    return `${shift.cashierName}: ${shift.transactionCount} tx, ${formatCLP(total)} total (${discStr}) — ${shift.status}`;
  }
}

export const merchantShift = new MerchantShiftService();
