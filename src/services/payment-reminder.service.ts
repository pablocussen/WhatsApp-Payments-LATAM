import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('payment-reminder');

const REM_PREFIX = 'payrem:';
const REM_TTL = 90 * 24 * 60 * 60;
const MAX_REMINDERS = 20;

export type ReminderFrequency = 'ONCE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type ReminderStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';

export interface PaymentReminder {
  id: string;
  userId: string;
  recipientPhone: string;
  amount: number;
  description: string;
  frequency: ReminderFrequency;
  nextReminder: string;
  remindersSent: number;
  maxReminders: number;
  status: ReminderStatus;
  createdAt: string;
}

export class PaymentReminderService {
  async createReminder(input: {
    userId: string;
    recipientPhone: string;
    amount: number;
    description: string;
    frequency?: ReminderFrequency;
    maxReminders?: number;
  }): Promise<PaymentReminder> {
    if (input.amount < 100) throw new Error('Monto minimo: $100.');
    if (!input.recipientPhone) throw new Error('Telefono requerido.');
    if (!input.description || input.description.length > 100) throw new Error('Descripcion entre 1 y 100 caracteres.');

    const reminders = await this.getReminders(input.userId);
    if (reminders.length >= MAX_REMINDERS) throw new Error(`Maximo ${MAX_REMINDERS} recordatorios.`);

    const freq = input.frequency ?? 'ONCE';
    const reminder: PaymentReminder = {
      id: `rem_${Date.now().toString(36)}`,
      userId: input.userId,
      recipientPhone: input.recipientPhone,
      amount: input.amount,
      description: input.description,
      frequency: freq,
      nextReminder: this.calcNextDate(freq),
      remindersSent: 0,
      maxReminders: input.maxReminders ?? (freq === 'ONCE' ? 1 : 10),
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
    };

    reminders.push(reminder);
    await this.saveReminders(input.userId, reminders);

    log.info('Reminder created', { reminderId: reminder.id, userId: input.userId, amount: input.amount });
    return reminder;
  }

  async getReminders(userId: string): Promise<PaymentReminder[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${REM_PREFIX}${userId}`);
      return raw ? JSON.parse(raw) as PaymentReminder[] : [];
    } catch {
      return [];
    }
  }

  async getDueReminders(userId: string): Promise<PaymentReminder[]> {
    const reminders = await this.getReminders(userId);
    const now = new Date();
    return reminders.filter(r =>
      r.status === 'ACTIVE' &&
      r.remindersSent < r.maxReminders &&
      new Date(r.nextReminder) <= now,
    );
  }

  async markSent(userId: string, reminderId: string): Promise<boolean> {
    const reminders = await this.getReminders(userId);
    const rem = reminders.find(r => r.id === reminderId);
    if (!rem) return false;

    rem.remindersSent++;
    if (rem.remindersSent >= rem.maxReminders || rem.frequency === 'ONCE') {
      rem.status = 'COMPLETED';
    } else {
      rem.nextReminder = this.calcNextDate(rem.frequency);
    }

    await this.saveReminders(userId, reminders);
    return true;
  }

  async cancelReminder(userId: string, reminderId: string): Promise<boolean> {
    const reminders = await this.getReminders(userId);
    const rem = reminders.find(r => r.id === reminderId);
    if (!rem || rem.status !== 'ACTIVE') return false;

    rem.status = 'CANCELLED';
    await this.saveReminders(userId, reminders);
    return true;
  }

  getReminderSummary(rem: PaymentReminder): string {
    return `${rem.description} — ${formatCLP(rem.amount)} a ${rem.recipientPhone} (${rem.frequency}, ${rem.remindersSent}/${rem.maxReminders} enviados)`;
  }

  private calcNextDate(freq: ReminderFrequency): string {
    const now = new Date();
    switch (freq) {
      case 'DAILY': now.setDate(now.getDate() + 1); break;
      case 'WEEKLY': now.setDate(now.getDate() + 7); break;
      case 'MONTHLY': now.setMonth(now.getMonth() + 1); break;
      default: break;
    }
    return now.toISOString();
  }

  private async saveReminders(userId: string, reminders: PaymentReminder[]): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${REM_PREFIX}${userId}`, JSON.stringify(reminders), { EX: REM_TTL });
    } catch (err) {
      log.warn('Failed to save reminders', { userId, error: (err as Error).message });
    }
  }
}

export const paymentReminders = new PaymentReminderService();
