import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { notifications } from './notification.service';

const log = createLogger('link-expiry');

const EXPIRY_CHECK_PREFIX = 'link-expiry:notified:';
const EXPIRY_TTL = 48 * 60 * 60; // 48h

export interface ExpiringLink {
  id: string;
  merchantId: string;
  shortCode: string;
  amount: number | null;
  description: string | null;
  expiresAt: string;
  hoursRemaining: number;
}

/**
 * Service that checks for payment links about to expire
 * and notifies the merchant.
 */
export class LinkExpiryService {
  /**
   * Check a link and notify if it's expiring within the threshold.
   * Returns true if notification was sent.
   */
  async checkAndNotify(link: {
    id: string;
    merchantId: string;
    shortCode: string;
    amount: number | null;
    description: string | null;
    expiresAt: string;
  }, thresholdHours = 6): Promise<boolean> {
    const expiresAt = new Date(link.expiresAt);
    const now = new Date();
    const hoursRemaining = (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60);

    // Not expiring soon
    if (hoursRemaining > thresholdHours || hoursRemaining <= 0) {
      return false;
    }

    // Already notified
    const notifiedKey = `${EXPIRY_CHECK_PREFIX}${link.id}`;
    try {
      const redis = getRedis();
      const alreadyNotified = await redis.get(notifiedKey);
      if (alreadyNotified) return false;

      // Mark as notified
      await redis.set(notifiedKey, '1', { EX: EXPIRY_TTL });
    } catch {
      return false;
    }

    // Send notification
    try {
      await notifications.create({
        userId: link.merchantId,
        type: 'security_alert', // reuse type
        title: 'Link de cobro por vencer',
        body: `Tu link ${link.shortCode}${link.description ? ` (${link.description})` : ''} vence en ${Math.round(hoursRemaining)} horas.`,
        data: {
          linkId: link.id,
          shortCode: link.shortCode,
          expiresAt: link.expiresAt,
          hoursRemaining: Math.round(hoursRemaining),
        },
      });

      log.info('Link expiry notification sent', {
        linkId: link.id,
        merchantId: link.merchantId,
        hoursRemaining: Math.round(hoursRemaining),
      });

      return true;
    } catch (err) {
      log.warn('Failed to send expiry notification', { error: (err as Error).message });
      return false;
    }
  }
}

export const linkExpiry = new LinkExpiryService();
