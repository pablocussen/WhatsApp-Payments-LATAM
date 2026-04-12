import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('gift-card');
const GC_PREFIX = 'giftcard:';
const GC_TTL = 365 * 24 * 60 * 60;

export type GiftCardStatus = 'ACTIVE' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED';

export interface GiftCard {
  id: string;
  code: string;
  purchaserId: string;
  recipientPhone: string | null;
  amount: number;
  balance: number;
  message: string | null;
  status: GiftCardStatus;
  createdAt: string;
  expiresAt: string;
  redeemedAt: string | null;
}

export class UserGiftCardService {
  async createGiftCard(input: { purchaserId: string; amount: number; recipientPhone?: string; message?: string; expiresInDays?: number }): Promise<GiftCard> {
    if (input.amount < 1000 || input.amount > 500000) throw new Error('Monto entre $1.000 y $500.000.');

    const expDays = input.expiresInDays ?? 365;
    const card: GiftCard = {
      id: 'gc_' + Date.now().toString(36),
      code: this.generateCode(),
      purchaserId: input.purchaserId,
      recipientPhone: input.recipientPhone ?? null,
      amount: input.amount,
      balance: input.amount,
      message: input.message ?? null,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + expDays * 24 * 60 * 60 * 1000).toISOString(),
      redeemedAt: null,
    };
    try { const redis = getRedis(); await redis.set(GC_PREFIX + card.code, JSON.stringify(card), { EX: GC_TTL }); }
    catch (err) { log.warn('Failed to save gift card', { error: (err as Error).message }); }
    log.info('Gift card created', { code: card.code, amount: input.amount });
    return card;
  }

  async redeemGiftCard(code: string, amount: number): Promise<{ success: boolean; balance: number; error?: string }> {
    const card = await this.getGiftCard(code);
    if (!card) return { success: false, balance: 0, error: 'Gift card no encontrada.' };
    if (card.status !== 'ACTIVE') return { success: false, balance: 0, error: 'Gift card no activa.' };
    if (new Date() > new Date(card.expiresAt)) {
      card.status = 'EXPIRED';
      await this.save(card);
      return { success: false, balance: 0, error: 'Gift card expirada.' };
    }
    if (amount > card.balance) return { success: false, balance: card.balance, error: 'Saldo insuficiente.' };

    card.balance -= amount;
    if (card.balance === 0) {
      card.status = 'REDEEMED';
      card.redeemedAt = new Date().toISOString();
    }
    await this.save(card);
    return { success: true, balance: card.balance };
  }

  async getGiftCard(code: string): Promise<GiftCard | null> {
    try { const redis = getRedis(); const raw = await redis.get(GC_PREFIX + code); return raw ? JSON.parse(raw) as GiftCard : null; }
    catch { return null; }
  }

  async cancelGiftCard(code: string): Promise<boolean> {
    const card = await this.getGiftCard(code);
    if (!card || card.status !== 'ACTIVE') return false;
    card.status = 'CANCELLED';
    await this.save(card);
    return true;
  }

  formatCardSummary(c: GiftCard): string {
    return 'Gift Card ' + c.code + ': ' + formatCLP(c.balance) + ' / ' + formatCLP(c.amount) + ' — ' + c.status;
  }

  private generateCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  private async save(card: GiftCard): Promise<void> {
    try { const redis = getRedis(); await redis.set(GC_PREFIX + card.code, JSON.stringify(card), { EX: GC_TTL }); }
    catch (err) { log.warn('Failed to save card', { error: (err as Error).message }); }
  }
}

export const userGiftCard = new UserGiftCardService();
