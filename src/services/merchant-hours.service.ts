import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-hours');

const HOURS_PREFIX = 'mhours:';
const HOURS_TTL = 365 * 24 * 60 * 60;

export type DayOfWeek = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

export interface TimeSlot {
  open: string; // "09:00"
  close: string; // "18:00"
}

export interface BusinessHours {
  merchantId: string;
  timezone: string;
  schedule: Record<DayOfWeek, TimeSlot | null>;
  holidaysClosed: string[]; // ISO dates
  autoReplyWhenClosed: string;
  updatedAt: string;
}

const DAY_LABELS: Record<DayOfWeek, string> = {
  MON: 'Lunes', TUE: 'Martes', WED: 'Miércoles', THU: 'Jueves',
  FRI: 'Viernes', SAT: 'Sábado', SUN: 'Domingo',
};

const DEFAULT_SCHEDULE: Record<DayOfWeek, TimeSlot | null> = {
  MON: { open: '09:00', close: '18:00' },
  TUE: { open: '09:00', close: '18:00' },
  WED: { open: '09:00', close: '18:00' },
  THU: { open: '09:00', close: '18:00' },
  FRI: { open: '09:00', close: '18:00' },
  SAT: { open: '10:00', close: '14:00' },
  SUN: null,
};

export class MerchantHoursService {
  async getHours(merchantId: string): Promise<BusinessHours> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${HOURS_PREFIX}${merchantId}`);
      if (raw) return JSON.parse(raw) as BusinessHours;
    } catch { /* defaults */ }

    return {
      merchantId,
      timezone: 'America/Santiago',
      schedule: { ...DEFAULT_SCHEDULE },
      holidaysClosed: [],
      autoReplyWhenClosed: 'Estamos cerrados en este momento. Te atenderemos en nuestro próximo horario de atención.',
      updatedAt: new Date().toISOString(),
    };
  }

  async setDayHours(merchantId: string, day: DayOfWeek, slot: TimeSlot | null): Promise<BusinessHours> {
    if (slot && (!slot.open || !slot.close)) throw new Error('Horario inválido.');
    if (slot && slot.open >= slot.close) throw new Error('Hora de apertura debe ser antes del cierre.');

    const hours = await this.getHours(merchantId);
    hours.schedule[day] = slot;
    hours.updatedAt = new Date().toISOString();
    await this.save(hours);
    return hours;
  }

  async addHoliday(merchantId: string, date: string): Promise<BusinessHours> {
    const hours = await this.getHours(merchantId);
    if (!hours.holidaysClosed.includes(date)) {
      hours.holidaysClosed.push(date);
      hours.updatedAt = new Date().toISOString();
      await this.save(hours);
    }
    return hours;
  }

  async setAutoReply(merchantId: string, message: string): Promise<BusinessHours> {
    if (!message || message.length > 500) throw new Error('Mensaje entre 1 y 500 caracteres.');
    const hours = await this.getHours(merchantId);
    hours.autoReplyWhenClosed = message;
    hours.updatedAt = new Date().toISOString();
    await this.save(hours);
    return hours;
  }

  isOpen(hours: BusinessHours, now?: Date): boolean {
    const date = now ?? new Date();
    const dateStr = date.toISOString().slice(0, 10);

    if (hours.holidaysClosed.includes(dateStr)) return false;

    const days: DayOfWeek[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
    const day = days[date.getDay()];
    const slot = hours.schedule[day];
    if (!slot) return false;

    const timeStr = date.toTimeString().slice(0, 5);
    return timeStr >= slot.open && timeStr < slot.close;
  }

  formatSchedule(hours: BusinessHours): string {
    const days: DayOfWeek[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
    return days.map(d => {
      const slot = hours.schedule[d];
      const label = DAY_LABELS[d];
      return slot ? `${label}: ${slot.open} - ${slot.close}` : `${label}: Cerrado`;
    }).join('\n');
  }

  private async save(hours: BusinessHours): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${HOURS_PREFIX}${hours.merchantId}`, JSON.stringify(hours), { EX: HOURS_TTL });
    } catch (err) {
      log.warn('Failed to save hours', { merchantId: hours.merchantId, error: (err as Error).message });
    }
  }
}

export const merchantHours = new MerchantHoursService();
