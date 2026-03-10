import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('contacts');

// ─── Types ──────────────────────────────────────────────

export interface Contact {
  userId: string;   // the contact's user ID
  waId: string;     // phone number
  name: string;     // display name
  alias?: string;   // user-given nickname
  addedAt: string;
}

const KEY_PREFIX = 'contacts:';
const MAX_CONTACTS = 20;
const TTL = 365 * 24 * 60 * 60; // 1 year

// ─── Service ────────────────────────────────────────────

export class ContactsService {
  private key(userId: string): string {
    return `${KEY_PREFIX}${userId}`;
  }

  /**
   * Get all saved contacts for a user.
   */
  async getContacts(userId: string): Promise<Contact[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(this.key(userId));
      if (!raw) return [];
      return JSON.parse(raw) as Contact[];
    } catch {
      return [];
    }
  }

  /**
   * Add a contact. Returns false if already exists or limit reached.
   */
  async addContact(
    ownerId: string,
    contact: { userId: string; waId: string; name: string; alias?: string },
  ): Promise<{ success: boolean; message: string }> {
    const contacts = await this.getContacts(ownerId);

    if (contacts.some((c) => c.userId === contact.userId)) {
      return { success: false, message: 'Este contacto ya está en tu lista.' };
    }

    if (contacts.length >= MAX_CONTACTS) {
      return { success: false, message: `Máximo ${MAX_CONTACTS} contactos. Elimina uno primero.` };
    }

    contacts.push({
      userId: contact.userId,
      waId: contact.waId,
      name: contact.name,
      alias: contact.alias,
      addedAt: new Date().toISOString(),
    });

    await this.save(ownerId, contacts);
    return { success: true, message: 'Contacto guardado.' };
  }

  /**
   * Remove a contact by userId.
   */
  async removeContact(ownerId: string, contactUserId: string): Promise<boolean> {
    const contacts = await this.getContacts(ownerId);
    const filtered = contacts.filter((c) => c.userId !== contactUserId);

    if (filtered.length === contacts.length) return false; // not found

    await this.save(ownerId, filtered);
    return true;
  }

  /**
   * Find a contact by phone number (partial match).
   */
  async findByPhone(ownerId: string, phone: string): Promise<Contact | undefined> {
    const contacts = await this.getContacts(ownerId);
    const normalized = phone.replace(/[\s\-+]/g, '');
    return contacts.find(
      (c) => c.waId === normalized || c.waId.endsWith(normalized) || normalized.endsWith(c.waId),
    );
  }

  private async save(userId: string, contacts: Contact[]): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(this.key(userId), JSON.stringify(contacts), { EX: TTL });
    } catch (err) {
      log.warn('Failed to save contacts', { userId, error: (err as Error).message });
    }
  }
}

export const contacts = new ContactsService();
