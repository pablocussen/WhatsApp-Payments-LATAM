import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('bill-reminder');
const BR_PREFIX = 'billrem:';
const BR_TTL = 365 * 24 * 60 * 60;

export type BillCategory = 'ELECTRICITY' | 'WATER' | 'GAS' | 'INTERNET' | 'PHONE' | 'RENT' | 'MORTGAGE' | 'CREDIT_CARD' | 'OTHER';

export interface BillReminder {
  id: string;
  userId: string;
  name: string;
  category: BillCategory;
  amount: number;
  dueDay: number;
  autopay: boolean;
  paidThisMonth: boolean;
  lastPaidAt: string | null;
  createdAt: string;
}

export class UserBillReminderService {
  async createReminder(input: { userId: string; name: string; category: BillCategory; amount: number; dueDay: number; autopay?: boolean }): Promise<BillReminder> {
    if (!input.name) throw new Error('Nombre requerido.');
    if (input.amount < 100) throw new Error('Monto minimo: $100.');
    if (input.dueDay < 1 || input.dueDay > 28) throw new Error('Dia entre 1 y 28.');

    const reminders = await this.getReminders(input.userId);
    if (reminders.length >= 20) throw new Error('Maximo 20 recordatorios.');

    const reminder: BillReminder = {
      id: 'bill_' + Date.now().toString(36),
      userId: input.userId,
      name: input.name,
      category: input.category,
      amount: input.amount,
      dueDay: input.dueDay,
      autopay: input.autopay ?? false,
      paidThisMonth: false,
      lastPaidAt: null,
      createdAt: new Date().toISOString(),
    };
    reminders.push(reminder);
    await this.save(input.userId, reminders);
    return reminder;
  }

  async getReminders(userId: string): Promise<BillReminder[]> {
    try { const redis = getRedis(); const raw = await redis.get(BR_PREFIX + userId); return raw ? JSON.parse(raw) as BillReminder[] : []; }
    catch { return []; }
  }

  async markPaid(userId: string, reminderId: string): Promise<boolean> {
    const reminders = await this.getReminders(userId);
    const r = reminders.find(x => x.id === reminderId);
    if (!r) return false;
    r.paidThisMonth = true;
    r.lastPaidAt = new Date().toISOString();
    await this.save(userId, reminders);
    return true;
  }

  async getUnpaidBills(userId: string): Promise<BillReminder[]> {
    const all = await this.getReminders(userId);
    return all.filter(r => !r.paidThisMonth);
  }

  async getTotalMonthly(userId: string): Promise<number> {
    const all = await this.getReminders(userId);
    return all.reduce((s, r) => s + r.amount, 0);
  }

  formatReminderSummary(r: BillReminder): string {
    const status = r.paidThisMonth ? 'pagado' : 'pendiente';
    const auto = r.autopay ? ' [autopay]' : '';
    return r.name + ': ' + formatCLP(r.amount) + ' — dia ' + r.dueDay + ' — ' + status + auto;
  }

  private async save(userId: string, reminders: BillReminder[]): Promise<void> {
    try { const redis = getRedis(); await redis.set(BR_PREFIX + userId, JSON.stringify(reminders), { EX: BR_TTL }); }
    catch (err) { log.warn('Failed to save reminders', { error: (err as Error).message }); }
  }
}

export const userBillReminder = new UserBillReminderService();
