import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-shift-handover');
const PREFIX = 'merchant:shift-handover:';
const TTL = 90 * 24 * 60 * 60;

export type HandoverStatus = 'PENDING_ACCEPTANCE' | 'ACCEPTED' | 'DISPUTED' | 'CANCELLED';

export interface HandoverChecklistItem {
  label: string;
  checked: boolean;
  notes?: string;
}

export interface ShiftHandover {
  id: string;
  merchantId: string;
  fromShiftId: string;
  toShiftId: string;
  fromEmployeeId: string;
  fromEmployeeName: string;
  toEmployeeId: string;
  toEmployeeName: string;
  cashInRegister: number;
  expectedCashInRegister: number;
  variance: number;
  checklist: HandoverChecklistItem[];
  notes: string;
  status: HandoverStatus;
  initiatedAt: string;
  acceptedAt?: string;
  disputeReason?: string;
}

export class MerchantShiftHandoverService {
  private key(merchantId: string): string {
    return `${PREFIX}${merchantId}`;
  }

  async list(merchantId: string): Promise<ShiftHandover[]> {
    const raw = await getRedis().get(this.key(merchantId));
    return raw ? JSON.parse(raw) : [];
  }

  async initiate(input: {
    merchantId: string;
    fromShiftId: string;
    toShiftId: string;
    fromEmployeeId: string;
    fromEmployeeName: string;
    toEmployeeId: string;
    toEmployeeName: string;
    cashInRegister: number;
    expectedCashInRegister: number;
    checklist: HandoverChecklistItem[];
    notes?: string;
  }): Promise<ShiftHandover> {
    if (input.cashInRegister < 0 || input.expectedCashInRegister < 0) {
      throw new Error('Montos no pueden ser negativos');
    }
    if (input.fromEmployeeId === input.toEmployeeId) {
      throw new Error('Empleado entrega y recibe no pueden ser el mismo');
    }
    if (input.checklist.length < 1) {
      throw new Error('Checklist requerido');
    }
    if (input.checklist.length > 20) {
      throw new Error('Maximo 20 items en checklist');
    }
    const list = await this.list(input.merchantId);
    if (list.some(h => h.fromShiftId === input.fromShiftId && h.status === 'PENDING_ACCEPTANCE')) {
      throw new Error('Ya existe handover pendiente para este turno');
    }
    const variance = input.cashInRegister - input.expectedCashInRegister;
    const handover: ShiftHandover = {
      id: `ho_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      merchantId: input.merchantId,
      fromShiftId: input.fromShiftId,
      toShiftId: input.toShiftId,
      fromEmployeeId: input.fromEmployeeId,
      fromEmployeeName: input.fromEmployeeName,
      toEmployeeId: input.toEmployeeId,
      toEmployeeName: input.toEmployeeName,
      cashInRegister: input.cashInRegister,
      expectedCashInRegister: input.expectedCashInRegister,
      variance,
      checklist: input.checklist,
      notes: input.notes ?? '',
      status: 'PENDING_ACCEPTANCE',
      initiatedAt: new Date().toISOString(),
    };
    list.push(handover);
    if (list.length > 500) list.splice(0, list.length - 500);
    await getRedis().set(this.key(input.merchantId), JSON.stringify(list), { EX: TTL });
    log.info('handover initiated', { id: handover.id });
    return handover;
  }

  async accept(merchantId: string, id: string, acceptingEmployeeId: string): Promise<ShiftHandover | null> {
    const list = await this.list(merchantId);
    const handover = list.find(h => h.id === id);
    if (!handover) return null;
    if (handover.status !== 'PENDING_ACCEPTANCE') throw new Error('Handover no esta pendiente');
    if (handover.toEmployeeId !== acceptingEmployeeId) {
      throw new Error('Solo el empleado receptor puede aceptar');
    }
    const allChecked = handover.checklist.every(c => c.checked);
    if (!allChecked) throw new Error('Todos los items del checklist deben estar verificados');
    handover.status = 'ACCEPTED';
    handover.acceptedAt = new Date().toISOString();
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return handover;
  }

  async dispute(merchantId: string, id: string, reason: string): Promise<ShiftHandover | null> {
    if (!reason || reason.length > 500) throw new Error('Razon invalida');
    const list = await this.list(merchantId);
    const handover = list.find(h => h.id === id);
    if (!handover) return null;
    if (handover.status !== 'PENDING_ACCEPTANCE') throw new Error('Handover no esta pendiente');
    handover.status = 'DISPUTED';
    handover.disputeReason = reason;
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    log.warn('handover disputed', { id, reason });
    return handover;
  }

  async cancel(merchantId: string, id: string): Promise<ShiftHandover | null> {
    const list = await this.list(merchantId);
    const handover = list.find(h => h.id === id);
    if (!handover) return null;
    if (handover.status === 'ACCEPTED') throw new Error('No se puede cancelar handover aceptado');
    handover.status = 'CANCELLED';
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return handover;
  }

  async getPending(merchantId: string): Promise<ShiftHandover[]> {
    const list = await this.list(merchantId);
    return list.filter(h => h.status === 'PENDING_ACCEPTANCE');
  }

  async getVarianceReport(merchantId: string, sinceDays = 30): Promise<{
    totalHandovers: number;
    withVariance: number;
    totalVariance: number;
    disputed: number;
  }> {
    const list = await this.list(merchantId);
    const cutoff = Date.now() - sinceDays * 86400000;
    const recent = list.filter(h => new Date(h.initiatedAt).getTime() > cutoff);
    return {
      totalHandovers: recent.length,
      withVariance: recent.filter(h => h.variance !== 0).length,
      totalVariance: recent.reduce((s, h) => s + Math.abs(h.variance), 0),
      disputed: recent.filter(h => h.status === 'DISPUTED').length,
    };
  }
}

export const merchantShiftHandover = new MerchantShiftHandoverService();
