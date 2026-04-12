import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('address-book');
const AB_PREFIX = 'addrbook:';
const AB_TTL = 365 * 24 * 60 * 60;
const MAX_CONTACTS = 100;

export interface Contact {
  id: string;
  userId: string;
  phone: string;
  name: string;
  nickname: string | null;
  favorite: boolean;
  lastPaidAt: string | null;
  totalPaid: number;
  paymentCount: number;
  addedAt: string;
}

export class UserAddressBookService {
  async addContact(userId: string, phone: string, name: string, nickname?: string): Promise<Contact> {
    if (!phone) throw new Error('Teléfono requerido.');
    if (!name) throw new Error('Nombre requerido.');
    const contacts = await this.getContacts(userId);
    if (contacts.some(c => c.phone === phone)) throw new Error('Contacto ya existe.');
    if (contacts.length >= MAX_CONTACTS) throw new Error(`Máximo ${MAX_CONTACTS} contactos.`);
    const contact: Contact = {
      id: `ct_${Date.now().toString(36)}`, userId, phone, name,
      nickname: nickname ?? null, favorite: false, lastPaidAt: null,
      totalPaid: 0, paymentCount: 0, addedAt: new Date().toISOString(),
    };
    contacts.push(contact);
    await this.save(userId, contacts);
    return contact;
  }

  async getContacts(userId: string): Promise<Contact[]> {
    try { const redis = getRedis(); const raw = await redis.get(`${AB_PREFIX}${userId}`); return raw ? JSON.parse(raw) as Contact[] : []; }
    catch { return []; }
  }

  async getFavorites(userId: string): Promise<Contact[]> {
    return (await this.getContacts(userId)).filter(c => c.favorite);
  }

  async getFrequent(userId: string, limit = 5): Promise<Contact[]> {
    return (await this.getContacts(userId)).sort((a, b) => b.paymentCount - a.paymentCount).slice(0, limit);
  }

  async toggleFavorite(userId: string, contactId: string): Promise<boolean> {
    const contacts = await this.getContacts(userId);
    const c = contacts.find(ct => ct.id === contactId);
    if (!c) return false;
    c.favorite = !c.favorite;
    await this.save(userId, contacts);
    return true;
  }

  async recordPayment(userId: string, phone: string, amount: number): Promise<void> {
    const contacts = await this.getContacts(userId);
    const c = contacts.find(ct => ct.phone === phone);
    if (c) { c.totalPaid += amount; c.paymentCount++; c.lastPaidAt = new Date().toISOString(); await this.save(userId, contacts); }
  }

  async deleteContact(userId: string, contactId: string): Promise<boolean> {
    const contacts = await this.getContacts(userId);
    const filtered = contacts.filter(c => c.id !== contactId);
    if (filtered.length === contacts.length) return false;
    await this.save(userId, filtered);
    return true;
  }

  async searchContacts(userId: string, query: string): Promise<Contact[]> {
    const contacts = await this.getContacts(userId);
    const q = query.toLowerCase();
    return contacts.filter(c => c.name.toLowerCase().includes(q) || c.phone.includes(q) || c.nickname?.toLowerCase().includes(q));
  }

  private async save(userId: string, contacts: Contact[]): Promise<void> {
    try { const redis = getRedis(); await redis.set(`${AB_PREFIX}${userId}`, JSON.stringify(contacts), { EX: AB_TTL }); }
    catch (err) { log.warn('Failed to save address book', { userId, error: (err as Error).message }); }
  }
}

export const userAddressBook = new UserAddressBookService();
