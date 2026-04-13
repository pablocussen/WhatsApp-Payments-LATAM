import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-trust-circle');
const PREFIX = 'user:trust-circle:';
const TTL = 365 * 24 * 60 * 60;

export type TrustLevel = 'FAMILY' | 'FRIEND' | 'BUSINESS' | 'VERIFIED';

export interface TrustedContact {
  id: string;
  userId: string;
  contactId: string;
  phone: string;
  name: string;
  level: TrustLevel;
  allowHigherLimits: boolean;
  limitMultiplier: number;
  addedAt: string;
  lastTransactionAt?: string;
  transactionCount: number;
}

export class UserTrustCircleService {
  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  private defaultMultiplier(level: TrustLevel): number {
    return level === 'FAMILY' ? 5 : level === 'FRIEND' ? 3 : level === 'BUSINESS' ? 2 : 1.5;
  }

  async list(userId: string): Promise<TrustedContact[]> {
    const raw = await getRedis().get(this.key(userId));
    return raw ? JSON.parse(raw) : [];
  }

  async add(input: {
    userId: string;
    contactId: string;
    phone: string;
    name: string;
    level: TrustLevel;
    allowHigherLimits?: boolean;
  }): Promise<TrustedContact> {
    if (!/^\+?[0-9]{8,15}$/.test(input.phone)) {
      throw new Error('Telefono invalido');
    }
    if (input.name.length > 50) throw new Error('Nombre excede 50 caracteres');
    const list = await this.list(input.userId);
    if (list.length >= 50) throw new Error('Maximo 50 contactos en trust circle');
    if (list.some(c => c.contactId === input.contactId)) {
      throw new Error('Contacto ya en trust circle');
    }
    const contact: TrustedContact = {
      id: `trust_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: input.userId,
      contactId: input.contactId,
      phone: input.phone,
      name: input.name,
      level: input.level,
      allowHigherLimits: input.allowHigherLimits ?? true,
      limitMultiplier: this.defaultMultiplier(input.level),
      addedAt: new Date().toISOString(),
      transactionCount: 0,
    };
    list.push(contact);
    await getRedis().set(this.key(input.userId), JSON.stringify(list), { EX: TTL });
    log.info('trust contact added', { id: contact.id, level: contact.level });
    return contact;
  }

  async updateLevel(userId: string, contactId: string, level: TrustLevel): Promise<TrustedContact | null> {
    const list = await this.list(userId);
    const contact = list.find(c => c.contactId === contactId);
    if (!contact) return null;
    contact.level = level;
    contact.limitMultiplier = this.defaultMultiplier(level);
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return contact;
  }

  async remove(userId: string, contactId: string): Promise<boolean> {
    const list = await this.list(userId);
    const idx = list.findIndex(c => c.contactId === contactId);
    if (idx === -1) return false;
    list.splice(idx, 1);
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return true;
  }

  async recordTransaction(userId: string, contactId: string): Promise<TrustedContact | null> {
    const list = await this.list(userId);
    const contact = list.find(c => c.contactId === contactId);
    if (!contact) return null;
    contact.transactionCount++;
    contact.lastTransactionAt = new Date().toISOString();
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return contact;
  }

  async isTrusted(userId: string, contactId: string): Promise<boolean> {
    const list = await this.list(userId);
    return list.some(c => c.contactId === contactId);
  }

  async getLimitMultiplier(userId: string, contactId: string): Promise<number> {
    const list = await this.list(userId);
    const contact = list.find(c => c.contactId === contactId);
    return contact && contact.allowHigherLimits ? contact.limitMultiplier : 1;
  }

  async getByLevel(userId: string, level: TrustLevel): Promise<TrustedContact[]> {
    const list = await this.list(userId);
    return list.filter(c => c.level === level);
  }
}

export const userTrustCircle = new UserTrustCircleService();
