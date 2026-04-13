import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-payment-calendar');
const PREFIX = 'user:pay-calendar:';
const TTL = 365 * 24 * 60 * 60;

export type EventType = 'BILL' | 'SUBSCRIPTION' | 'LOAN' | 'TRANSFER' | 'CUSTOM';

export interface CalendarEvent {
  id: string;
  userId: string;
  type: EventType;
  title: string;
  amount: number;
  date: string;
  recurring: boolean;
  recurringInterval?: 'MONTHLY' | 'WEEKLY' | 'YEARLY';
  notified: boolean;
  completed: boolean;
  createdAt: string;
}

export class UserPaymentCalendarService {
  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  async list(userId: string): Promise<CalendarEvent[]> {
    const raw = await getRedis().get(this.key(userId));
    return raw ? JSON.parse(raw) : [];
  }

  async addEvent(input: {
    userId: string;
    type: EventType;
    title: string;
    amount: number;
    date: string;
    recurring?: boolean;
    recurringInterval?: 'MONTHLY' | 'WEEKLY' | 'YEARLY';
  }): Promise<CalendarEvent> {
    if (input.amount <= 0) throw new Error('Monto debe ser positivo');
    if (input.title.length > 60) throw new Error('Titulo excede 60 caracteres');
    if (isNaN(new Date(input.date).getTime())) throw new Error('Fecha invalida');
    if (input.recurring && !input.recurringInterval) {
      throw new Error('Evento recurrente requiere intervalo');
    }
    const list = await this.list(input.userId);
    if (list.filter(e => !e.completed).length >= 100) {
      throw new Error('Maximo 100 eventos activos');
    }
    const event: CalendarEvent = {
      id: `cal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: input.userId,
      type: input.type,
      title: input.title,
      amount: input.amount,
      date: input.date,
      recurring: input.recurring ?? false,
      recurringInterval: input.recurringInterval,
      notified: false,
      completed: false,
      createdAt: new Date().toISOString(),
    };
    list.push(event);
    await getRedis().set(this.key(input.userId), JSON.stringify(list), { EX: TTL });
    log.info('calendar event added', { id: event.id });
    return event;
  }

  async markCompleted(userId: string, id: string): Promise<CalendarEvent | null> {
    const list = await this.list(userId);
    const event = list.find(e => e.id === id);
    if (!event || event.completed) return null;
    event.completed = true;
    if (event.recurring && event.recurringInterval) {
      const nextDate = new Date(event.date);
      if (event.recurringInterval === 'MONTHLY') nextDate.setUTCMonth(nextDate.getUTCMonth() + 1);
      if (event.recurringInterval === 'WEEKLY') nextDate.setUTCDate(nextDate.getUTCDate() + 7);
      if (event.recurringInterval === 'YEARLY') nextDate.setUTCFullYear(nextDate.getUTCFullYear() + 1);
      list.push({
        ...event,
        id: `cal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        date: nextDate.toISOString(),
        notified: false,
        completed: false,
        createdAt: new Date().toISOString(),
      });
    }
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return event;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const list = await this.list(userId);
    const idx = list.findIndex(e => e.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return true;
  }

  async getUpcoming(userId: string, days: number): Promise<CalendarEvent[]> {
    const list = await this.list(userId);
    const now = Date.now();
    const cutoff = now + days * 86400000;
    return list
      .filter(e => !e.completed && new Date(e.date).getTime() >= now && new Date(e.date).getTime() <= cutoff)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  async getOverdue(userId: string): Promise<CalendarEvent[]> {
    const list = await this.list(userId);
    const now = Date.now();
    return list.filter(e => !e.completed && new Date(e.date).getTime() < now);
  }

  async getMonthTotal(userId: string, year: number, month: number): Promise<number> {
    const list = await this.list(userId);
    return list
      .filter(e => {
        const d = new Date(e.date);
        return d.getUTCFullYear() === year && d.getUTCMonth() === month;
      })
      .reduce((sum, e) => sum + e.amount, 0);
  }
}

export const userPaymentCalendar = new UserPaymentCalendarService();
