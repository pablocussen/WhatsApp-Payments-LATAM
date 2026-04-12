import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('pay-sched-notif');
const PSN_PREFIX = 'pschednotif:';
const PSN_TTL = 30 * 24 * 60 * 60;

export interface ScheduleNotification {
  id: string;
  userId: string;
  ruleId: string;
  type: 'UPCOMING' | 'EXECUTED' | 'FAILED' | 'SKIPPED';
  amount: number;
  recipientPhone: string;
  message: string;
  sentAt: string;
  read: boolean;
}

export class PaymentScheduleNotificationService {
  async notify(input: Omit<ScheduleNotification, 'id' | 'sentAt' | 'read'>): Promise<ScheduleNotification> {
    const notif: ScheduleNotification = { ...input, id: `psn_${Date.now().toString(36)}`, sentAt: new Date().toISOString(), read: false };
    try {
      const redis = getRedis();
      await redis.lPush(`${PSN_PREFIX}${input.userId}`, JSON.stringify(notif));
      await redis.lTrim(`${PSN_PREFIX}${input.userId}`, 0, 49);
      await redis.expire(`${PSN_PREFIX}${input.userId}`, PSN_TTL);
    } catch (err) { log.warn('Failed to save schedule notification', { error: (err as Error).message }); }
    return notif;
  }

  async getNotifications(userId: string, limit = 10): Promise<ScheduleNotification[]> {
    try { const redis = getRedis(); const raw = await redis.lRange(`${PSN_PREFIX}${userId}`, 0, limit - 1); return raw.map(r => JSON.parse(r) as ScheduleNotification); }
    catch { return []; }
  }

  formatUpcoming(amount: number, recipient: string, date: string): string {
    return `Pago programado: ${formatCLP(amount)} a ${recipient} el ${date}. Asegurate de tener saldo.`;
  }

  formatExecuted(amount: number, recipient: string, ref: string): string {
    return `Pago programado ejecutado: ${formatCLP(amount)} a ${recipient}. Ref: ${ref}`;
  }

  formatFailed(amount: number, recipient: string, reason: string): string {
    return `Pago programado fallido: ${formatCLP(amount)} a ${recipient}. Razon: ${reason}`;
  }
}

export const paymentScheduleNotification = new PaymentScheduleNotificationService();
