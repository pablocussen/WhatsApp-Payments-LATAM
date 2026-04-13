import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-gift-card');
const PREFIX = 'merchant:gift-card:';
const TTL = 2 * 365 * 24 * 60 * 60;

export type GiftCardStatus = 'ACTIVE' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED';

export interface GiftCard {
  id: string;
  code: string;
  merchantId: string;
  buyerPhone: string;
  recipientPhone?: string;
  recipientName?: string;
  faceValue: number;
  balance: number;
  message?: string;
  status: GiftCardStatus;
  expiresAt: string;
  createdAt: string;
  activatedAt?: string;
  redemptions: { amount: number; at: string; reference?: string }[];
}

export class MerchantGiftCardService {
  private key(merchantId: string): string {
    return `${PREFIX}${merchantId}`;
  }

  private generateCode(): string {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 12; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
      if (i === 3 || i === 7) code += '-';
    }
    return code;
  }

  async list(merchantId: string): Promise<GiftCard[]> {
    const raw = await getRedis().get(this.key(merchantId));
    return raw ? JSON.parse(raw) : [];
  }

  async issue(input: {
    merchantId: string;
    buyerPhone: string;
    faceValue: number;
    recipientPhone?: string;
    recipientName?: string;
    message?: string;
    validMonths?: number;
  }): Promise<GiftCard> {
    if (input.faceValue < 1000 || input.faceValue > 500000) {
      throw new Error('Valor entre $1.000 y $500.000');
    }
    if (!/^\+?[0-9]{8,15}$/.test(input.buyerPhone)) throw new Error('Telefono comprador invalido');
    if (input.recipientPhone && !/^\+?[0-9]{8,15}$/.test(input.recipientPhone)) {
      throw new Error('Telefono destinatario invalido');
    }
    if (input.message && input.message.length > 200) {
      throw new Error('Mensaje excede 200 caracteres');
    }
    const validMonths = input.validMonths ?? 12;
    if (validMonths < 1 || validMonths > 24) throw new Error('Validez entre 1 y 24 meses');
    const list = await this.list(input.merchantId);
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + validMonths);
    const card: GiftCard = {
      id: `gc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      code: this.generateCode(),
      merchantId: input.merchantId,
      buyerPhone: input.buyerPhone,
      recipientPhone: input.recipientPhone,
      recipientName: input.recipientName,
      faceValue: input.faceValue,
      balance: input.faceValue,
      message: input.message,
      status: 'ACTIVE',
      expiresAt: expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
      activatedAt: new Date().toISOString(),
      redemptions: [],
    };
    list.push(card);
    if (list.length > 5000) list.splice(0, list.length - 5000);
    await getRedis().set(this.key(input.merchantId), JSON.stringify(list), { EX: TTL });
    log.info('gift card issued', { id: card.id, value: card.faceValue });
    return card;
  }

  async findByCode(merchantId: string, code: string): Promise<GiftCard | null> {
    const list = await this.list(merchantId);
    return list.find(c => c.code === code) ?? null;
  }

  async redeem(merchantId: string, code: string, amount: number, reference?: string): Promise<GiftCard | null> {
    if (amount <= 0) throw new Error('Monto debe ser positivo');
    const list = await this.list(merchantId);
    const card = list.find(c => c.code === code);
    if (!card) return null;
    if (card.status !== 'ACTIVE') throw new Error(`Tarjeta ${card.status.toLowerCase()}`);
    if (new Date(card.expiresAt).getTime() < Date.now()) {
      card.status = 'EXPIRED';
      await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
      throw new Error('Tarjeta expirada');
    }
    if (amount > card.balance) throw new Error(`Saldo insuficiente: $${card.balance}`);
    card.balance -= amount;
    card.redemptions.push({ amount, at: new Date().toISOString(), reference });
    if (card.balance === 0) card.status = 'REDEEMED';
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    log.info('gift card redeemed', { code, amount, remaining: card.balance });
    return card;
  }

  async cancel(merchantId: string, code: string): Promise<GiftCard | null> {
    const list = await this.list(merchantId);
    const card = list.find(c => c.code === code);
    if (!card) return null;
    if (card.status === 'REDEEMED') throw new Error('No se puede cancelar tarjeta ya redimida');
    card.status = 'CANCELLED';
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return card;
  }

  async getStats(merchantId: string): Promise<{ issued: number; totalIssued: number; totalRedeemed: number; activeBalance: number; expiredCount: number }> {
    const list = await this.list(merchantId);
    let totalIssued = 0;
    let totalRedeemed = 0;
    let activeBalance = 0;
    let expiredCount = 0;
    for (const c of list) {
      totalIssued += c.faceValue;
      totalRedeemed += c.faceValue - c.balance;
      if (c.status === 'ACTIVE') activeBalance += c.balance;
      if (c.status === 'EXPIRED') expiredCount++;
    }
    return {
      issued: list.length,
      totalIssued,
      totalRedeemed,
      activeBalance,
      expiredCount,
    };
  }

  async expireOld(merchantId: string): Promise<number> {
    const list = await this.list(merchantId);
    const now = Date.now();
    let count = 0;
    for (const c of list) {
      if (c.status === 'ACTIVE' && new Date(c.expiresAt).getTime() < now) {
        c.status = 'EXPIRED';
        count++;
      }
    }
    if (count > 0) {
      await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    }
    return count;
  }
}

export const merchantGiftCard = new MerchantGiftCardService();
