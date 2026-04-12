import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('abandoned-cart');
const AC_PREFIX = 'abncart:';
const AC_TTL = 7 * 24 * 60 * 60;

export type CartStatus = 'ACTIVE' | 'ABANDONED' | 'RECOVERED' | 'EXPIRED';

export interface AbandonedCart {
  id: string;
  merchantId: string;
  customerPhone: string;
  items: { name: string; quantity: number; price: number }[];
  totalAmount: number;
  status: CartStatus;
  remindersSent: number;
  lastActivityAt: string;
  createdAt: string;
  recoveredAt: string | null;
}

export class MerchantAbandonedCartService {
  async saveCart(input: {
    merchantId: string; customerPhone: string;
    items: { name: string; quantity: number; price: number }[];
  }): Promise<AbandonedCart> {
    if (input.items.length === 0) throw new Error('Carrito debe tener items.');
    const totalAmount = input.items.reduce((s, i) => s + (i.price * i.quantity), 0);

    const cart: AbandonedCart = {
      id: 'cart_' + Date.now().toString(36),
      merchantId: input.merchantId,
      customerPhone: input.customerPhone,
      items: input.items,
      totalAmount,
      status: 'ACTIVE',
      remindersSent: 0,
      lastActivityAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      recoveredAt: null,
    };

    try { const redis = getRedis(); await redis.set(AC_PREFIX + cart.id, JSON.stringify(cart), { EX: AC_TTL }); }
    catch (err) { log.warn('Failed to save cart', { error: (err as Error).message }); }
    return cart;
  }

  async markAbandoned(cartId: string): Promise<boolean> {
    const cart = await this.getCart(cartId);
    if (!cart || cart.status !== 'ACTIVE') return false;
    cart.status = 'ABANDONED';
    try { const redis = getRedis(); await redis.set(AC_PREFIX + cartId, JSON.stringify(cart), { EX: AC_TTL }); }
    catch { return false; }
    return true;
  }

  async markRecovered(cartId: string): Promise<boolean> {
    const cart = await this.getCart(cartId);
    if (!cart || cart.status === 'RECOVERED') return false;
    cart.status = 'RECOVERED';
    cart.recoveredAt = new Date().toISOString();
    try { const redis = getRedis(); await redis.set(AC_PREFIX + cartId, JSON.stringify(cart), { EX: AC_TTL }); }
    catch { return false; }
    log.info('Cart recovered', { cartId, amount: cart.totalAmount });
    return true;
  }

  async incrementReminder(cartId: string): Promise<boolean> {
    const cart = await this.getCart(cartId);
    if (!cart || cart.remindersSent >= 3) return false;
    cart.remindersSent++;
    try { const redis = getRedis(); await redis.set(AC_PREFIX + cartId, JSON.stringify(cart), { EX: AC_TTL }); }
    catch { return false; }
    return true;
  }

  async getCart(cartId: string): Promise<AbandonedCart | null> {
    try { const redis = getRedis(); const raw = await redis.get(AC_PREFIX + cartId); return raw ? JSON.parse(raw) as AbandonedCart : null; }
    catch { return null; }
  }

  formatCartSummary(c: AbandonedCart): string {
    return c.id + ': ' + formatCLP(c.totalAmount) + ' — ' + c.items.length + ' items — ' + c.status + ' (' + c.remindersSent + ' recordatorios)';
  }
}

export const merchantAbandonedCart = new MerchantAbandonedCartService();
