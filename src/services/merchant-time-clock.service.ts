import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-time-clock');
const PREFIX = 'merchant:time-clock:';
const TTL = 180 * 24 * 60 * 60;

export type ClockStatus = 'CLOCKED_IN' | 'ON_BREAK' | 'CLOCKED_OUT';

export interface TimeClockEntry {
  id: string;
  merchantId: string;
  employeeId: string;
  employeeName: string;
  clockInAt: string;
  clockOutAt?: string;
  breaks: { startAt: string; endAt?: string }[];
  totalBreakMinutes: number;
  totalWorkMinutes: number;
  status: ClockStatus;
  hourlyRate?: number;
  earnedAmount?: number;
}

export class MerchantTimeClockService {
  private key(merchantId: string): string {
    return `${PREFIX}${merchantId}`;
  }

  async list(merchantId: string): Promise<TimeClockEntry[]> {
    const raw = await getRedis().get(this.key(merchantId));
    return raw ? JSON.parse(raw) : [];
  }

  async getActive(merchantId: string, employeeId: string): Promise<TimeClockEntry | null> {
    const list = await this.list(merchantId);
    return list.find(e => e.employeeId === employeeId && e.status !== 'CLOCKED_OUT') ?? null;
  }

  async clockIn(input: {
    merchantId: string;
    employeeId: string;
    employeeName: string;
    hourlyRate?: number;
  }): Promise<TimeClockEntry> {
    if (input.hourlyRate !== undefined && input.hourlyRate < 0) {
      throw new Error('Tarifa por hora no puede ser negativa');
    }
    const existing = await this.getActive(input.merchantId, input.employeeId);
    if (existing) throw new Error('Empleado ya tiene turno activo');
    const entry: TimeClockEntry = {
      id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      merchantId: input.merchantId,
      employeeId: input.employeeId,
      employeeName: input.employeeName,
      clockInAt: new Date().toISOString(),
      breaks: [],
      totalBreakMinutes: 0,
      totalWorkMinutes: 0,
      status: 'CLOCKED_IN',
      hourlyRate: input.hourlyRate,
    };
    const list = await this.list(input.merchantId);
    list.push(entry);
    if (list.length > 1000) list.splice(0, list.length - 1000);
    await getRedis().set(this.key(input.merchantId), JSON.stringify(list), { EX: TTL });
    log.info('clocked in', { employeeId: input.employeeId });
    return entry;
  }

  async startBreak(merchantId: string, employeeId: string): Promise<TimeClockEntry | null> {
    const list = await this.list(merchantId);
    const entry = list.find(e => e.employeeId === employeeId && e.status === 'CLOCKED_IN');
    if (!entry) return null;
    entry.breaks.push({ startAt: new Date().toISOString() });
    entry.status = 'ON_BREAK';
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return entry;
  }

  async endBreak(merchantId: string, employeeId: string): Promise<TimeClockEntry | null> {
    const list = await this.list(merchantId);
    const entry = list.find(e => e.employeeId === employeeId && e.status === 'ON_BREAK');
    if (!entry) return null;
    const openBreak = entry.breaks[entry.breaks.length - 1];
    if (!openBreak || openBreak.endAt) return null;
    openBreak.endAt = new Date().toISOString();
    const breakMinutes = Math.round((new Date(openBreak.endAt).getTime() - new Date(openBreak.startAt).getTime()) / 60000);
    entry.totalBreakMinutes += breakMinutes;
    entry.status = 'CLOCKED_IN';
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return entry;
  }

  async clockOut(merchantId: string, employeeId: string): Promise<TimeClockEntry | null> {
    const list = await this.list(merchantId);
    const entry = list.find(e => e.employeeId === employeeId && e.status !== 'CLOCKED_OUT');
    if (!entry) return null;
    if (entry.status === 'ON_BREAK') {
      const openBreak = entry.breaks[entry.breaks.length - 1];
      if (openBreak && !openBreak.endAt) {
        openBreak.endAt = new Date().toISOString();
        entry.totalBreakMinutes += Math.round((new Date(openBreak.endAt).getTime() - new Date(openBreak.startAt).getTime()) / 60000);
      }
    }
    entry.clockOutAt = new Date().toISOString();
    const totalMinutes = Math.round((new Date(entry.clockOutAt).getTime() - new Date(entry.clockInAt).getTime()) / 60000);
    entry.totalWorkMinutes = Math.max(0, totalMinutes - entry.totalBreakMinutes);
    entry.status = 'CLOCKED_OUT';
    if (entry.hourlyRate !== undefined) {
      entry.earnedAmount = Math.round((entry.totalWorkMinutes / 60) * entry.hourlyRate);
    }
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    log.info('clocked out', { employeeId, minutes: entry.totalWorkMinutes });
    return entry;
  }

  async getEmployeeHours(merchantId: string, employeeId: string, since?: string): Promise<{ totalMinutes: number; totalEarned: number; sessions: number }> {
    const list = await this.list(merchantId);
    const sinceMs = since ? new Date(since).getTime() : 0;
    const sessions = list.filter(e =>
      e.employeeId === employeeId &&
      e.status === 'CLOCKED_OUT' &&
      new Date(e.clockInAt).getTime() >= sinceMs,
    );
    return {
      totalMinutes: sessions.reduce((sum, e) => sum + e.totalWorkMinutes, 0),
      totalEarned: sessions.reduce((sum, e) => sum + (e.earnedAmount ?? 0), 0),
      sessions: sessions.length,
    };
  }

  async getCurrentlyActive(merchantId: string): Promise<TimeClockEntry[]> {
    const list = await this.list(merchantId);
    return list.filter(e => e.status !== 'CLOCKED_OUT');
  }
}

export const merchantTimeClock = new MerchantTimeClockService();
