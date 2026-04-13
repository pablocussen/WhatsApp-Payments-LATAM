import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-withholding-tracker');
const PREFIX = 'user:withholding:';
const TTL = 3 * 365 * 24 * 60 * 60;

export type WithholdingType = 'HONORARIOS' | 'ARRIENDO' | 'DIVIDENDO' | 'OTRO';

export interface WithholdingRecord {
  id: string;
  userId: string;
  type: WithholdingType;
  payerName: string;
  payerRUT: string;
  grossAmount: number;
  retentionRate: number;
  withheld: number;
  netAmount: number;
  period: string;
  documentNumber?: string;
  createdAt: string;
}

export class UserWithholdingTrackerService {
  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  async list(userId: string): Promise<WithholdingRecord[]> {
    const raw = await getRedis().get(this.key(userId));
    return raw ? JSON.parse(raw) : [];
  }

  private validateRUT(rut: string): boolean {
    return /^\d{7,8}-[\dkK]$/.test(rut);
  }

  async record(input: {
    userId: string;
    type: WithholdingType;
    payerName: string;
    payerRUT: string;
    grossAmount: number;
    period: string;
    documentNumber?: string;
    retentionRate?: number;
  }): Promise<WithholdingRecord> {
    if (input.grossAmount <= 0) throw new Error('Monto bruto debe ser positivo');
    if (!this.validateRUT(input.payerRUT)) throw new Error('RUT invalido');
    if (input.payerName.length > 100) throw new Error('Nombre excede 100 caracteres');
    if (!/^\d{4}-\d{2}$/.test(input.period)) throw new Error('Periodo debe ser YYYY-MM');
    const defaults: Record<WithholdingType, number> = {
      HONORARIOS: 13.75,
      ARRIENDO: 10,
      DIVIDENDO: 35,
      OTRO: 0,
    };
    const retentionRate = input.retentionRate ?? defaults[input.type];
    if (retentionRate < 0 || retentionRate > 50) {
      throw new Error('Tasa de retencion entre 0 y 50 por ciento');
    }
    const withheld = Math.round(input.grossAmount * (retentionRate / 100));
    const record: WithholdingRecord = {
      id: `wh_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: input.userId,
      type: input.type,
      payerName: input.payerName,
      payerRUT: input.payerRUT,
      grossAmount: input.grossAmount,
      retentionRate,
      withheld,
      netAmount: input.grossAmount - withheld,
      period: input.period,
      documentNumber: input.documentNumber,
      createdAt: new Date().toISOString(),
    };
    const list = await this.list(input.userId);
    list.push(record);
    if (list.length > 500) list.splice(0, list.length - 500);
    await getRedis().set(this.key(input.userId), JSON.stringify(list), { EX: TTL });
    log.info('withholding recorded', { id: record.id, withheld });
    return record;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const list = await this.list(userId);
    const idx = list.findIndex(r => r.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return true;
  }

  async getYearSummary(userId: string, year: number): Promise<{
    totalGross: number;
    totalWithheld: number;
    totalNet: number;
    byType: Record<WithholdingType, { gross: number; withheld: number; count: number }>;
  }> {
    const list = await this.list(userId);
    const yearStr = String(year);
    const filtered = list.filter(r => r.period.startsWith(yearStr));
    const byType: Record<WithholdingType, { gross: number; withheld: number; count: number }> = {
      HONORARIOS: { gross: 0, withheld: 0, count: 0 },
      ARRIENDO: { gross: 0, withheld: 0, count: 0 },
      DIVIDENDO: { gross: 0, withheld: 0, count: 0 },
      OTRO: { gross: 0, withheld: 0, count: 0 },
    };
    let totalGross = 0;
    let totalWithheld = 0;
    for (const r of filtered) {
      totalGross += r.grossAmount;
      totalWithheld += r.withheld;
      byType[r.type].gross += r.grossAmount;
      byType[r.type].withheld += r.withheld;
      byType[r.type].count++;
    }
    return { totalGross, totalWithheld, totalNet: totalGross - totalWithheld, byType };
  }

  async getByPeriod(userId: string, period: string): Promise<WithholdingRecord[]> {
    const list = await this.list(userId);
    return list.filter(r => r.period === period);
  }

  async exportForTaxFiling(userId: string, year: number): Promise<string> {
    const summary = await this.getYearSummary(userId, year);
    const lines = [
      `Declaracion preparatoria - Ano ${year}`,
      `================================`,
      `Total ingresos brutos: $${summary.totalGross.toLocaleString('es-CL')}`,
      `Total retenido: $${summary.totalWithheld.toLocaleString('es-CL')}`,
      `Total neto percibido: $${summary.totalNet.toLocaleString('es-CL')}`,
      '',
      'Por tipo:',
    ];
    for (const [type, data] of Object.entries(summary.byType)) {
      if (data.count > 0) {
        lines.push(`  ${type}: ${data.count} registros, bruto $${data.gross.toLocaleString('es-CL')}, retenido $${data.withheld.toLocaleString('es-CL')}`);
      }
    }
    return lines.join('\n');
  }
}

export const userWithholdingTracker = new UserWithholdingTrackerService();
