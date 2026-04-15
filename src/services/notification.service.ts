import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';
import { type Locale } from '../utils/i18n';

const log = createLogger('notifications');

const NOTIF_PREFIX = 'notif:';
const NOTIF_TTL = 30 * 24 * 60 * 60; // 30 days

export type NotificationType =
  | 'payment_received'
  | 'payment_sent'
  | 'refund_received'
  | 'split_created'
  | 'split_paid'
  | 'payment_request'
  | 'scheduled_executed'
  | 'tip_received'
  | 'account_deletion'
  | 'security_alert';

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  read: boolean;
  createdAt: string;
}

/**
 * Centralized notification service.
 * Stores notifications for users and generates localized messages.
 */
export class NotificationService {
  /**
   * Create and store a notification.
   */
  async create(input: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, unknown>;
  }): Promise<Notification> {
    const notif: Notification = {
      id: `ntf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data ?? {},
      read: false,
      createdAt: new Date().toISOString(),
    };

    try {
      const redis = getRedis();
      // Store notification
      await redis.set(`${NOTIF_PREFIX}${notif.id}`, JSON.stringify(notif), { EX: NOTIF_TTL });
      // Add to user's notification list
      await redis.lPush(`${NOTIF_PREFIX}user:${input.userId}`, notif.id);
      await redis.lTrim(`${NOTIF_PREFIX}user:${input.userId}`, 0, 49); // keep last 50
    } catch (err) {
      log.warn('Failed to store notification', { error: (err as Error).message });
    }

    return notif;
  }

  /**
   * Get user's notifications.
   */
  async getUserNotifications(userId: string, limit = 20): Promise<Notification[]> {
    try {
      const redis = getRedis();
      const ids = await redis.lRange(`${NOTIF_PREFIX}user:${userId}`, 0, limit - 1);
      const notifications: Notification[] = [];

      for (const id of ids) {
        const raw = await redis.get(`${NOTIF_PREFIX}${id}`);
        if (raw) notifications.push(JSON.parse(raw));
      }

      return notifications;
    } catch {
      return [];
    }
  }

  /**
   * Mark a notification as read.
   */
  async markRead(notifId: string): Promise<boolean> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${NOTIF_PREFIX}${notifId}`);
      if (!raw) return false;

      const notif: Notification = JSON.parse(raw);
      notif.read = true;
      await redis.set(`${NOTIF_PREFIX}${notifId}`, JSON.stringify(notif), { EX: NOTIF_TTL });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get unread count for a user.
   */
  async getUnreadCount(userId: string): Promise<number> {
    const notifications = await this.getUserNotifications(userId, 50);
    return notifications.filter(n => !n.read).length;
  }

  // ─── Localized notification templates ────────────────

  /**
   * Create payment received notification.
   */
  async notifyPaymentReceived(input: {
    receiverId: string;
    senderName: string;
    amount: number;
    reference: string;
    locale?: Locale;
  }): Promise<Notification> {
    const l = input.locale ?? 'es';
    return this.create({
      userId: input.receiverId,
      type: 'payment_received',
      title: l === 'en' ? 'Payment received' : 'Pago recibido',
      body: l === 'en'
        ? `${input.senderName} sent you ${formatCLP(input.amount)} (${input.reference})`
        : `${input.senderName} te envió ${formatCLP(input.amount)} (${input.reference})`,
      data: { senderName: input.senderName, amount: input.amount, reference: input.reference },
    });
  }

  /**
   * Create tip received notification.
   */
  async notifyTipReceived(input: {
    receiverId: string;
    senderName: string;
    tipAmount: number;
    baseAmount: number;
  }): Promise<Notification> {
    return this.create({
      userId: input.receiverId,
      type: 'tip_received',
      title: 'Propina recibida',
      body: `${input.senderName} dejó ${formatCLP(input.tipAmount)} de propina (pago: ${formatCLP(input.baseAmount)})`,
      data: input,
    });
  }

  /**
   * Create security alert notification.
   */
  async notifySecurityAlert(input: {
    userId: string;
    message: string;
    details?: Record<string, unknown>;
  }): Promise<Notification> {
    return this.create({
      userId: input.userId,
      type: 'security_alert',
      title: 'Alerta de seguridad',
      body: input.message,
      data: input.details ?? {},
    });
  }
}

export const notifications = new NotificationService();
