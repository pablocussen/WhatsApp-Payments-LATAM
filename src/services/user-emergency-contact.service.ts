import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('emergency-contact');
const EC_PREFIX = 'emergcont:';
const EC_TTL = 365 * 24 * 60 * 60;

export interface EmergencyContact {
  id: string;
  userId: string;
  name: string;
  phone: string;
  relationship: string;
  priority: number;
  notifyOnLock: boolean;
  notifyOnSuspicious: boolean;
  addedAt: string;
}

export class UserEmergencyContactService {
  async addContact(input: { userId: string; name: string; phone: string; relationship: string; notifyOnLock?: boolean }): Promise<EmergencyContact> {
    if (!input.name || input.name.length > 50) throw new Error('Nombre entre 1 y 50 caracteres.');
    if (!input.phone) throw new Error('Telefono requerido.');

    const contacts = await this.getContacts(input.userId);
    if (contacts.length >= 3) throw new Error('Maximo 3 contactos de emergencia.');

    const contact: EmergencyContact = {
      id: 'ec_' + Date.now().toString(36),
      userId: input.userId,
      name: input.name,
      phone: input.phone,
      relationship: input.relationship,
      priority: contacts.length + 1,
      notifyOnLock: input.notifyOnLock ?? true,
      notifyOnSuspicious: false,
      addedAt: new Date().toISOString(),
    };
    contacts.push(contact);
    await this.save(input.userId, contacts);
    return contact;
  }

  async getContacts(userId: string): Promise<EmergencyContact[]> {
    try { const redis = getRedis(); const raw = await redis.get(EC_PREFIX + userId); return raw ? JSON.parse(raw) as EmergencyContact[] : []; }
    catch { return []; }
  }

  async removeContact(userId: string, contactId: string): Promise<boolean> {
    const contacts = await this.getContacts(userId);
    const filtered = contacts.filter(c => c.id !== contactId);
    if (filtered.length === contacts.length) return false;
    filtered.forEach((c, i) => c.priority = i + 1);
    await this.save(userId, filtered);
    return true;
  }

  async updatePriority(userId: string, contactId: string, newPriority: number): Promise<boolean> {
    if (newPriority < 1 || newPriority > 3) return false;
    const contacts = await this.getContacts(userId);
    const contact = contacts.find(c => c.id === contactId);
    if (!contact) return false;
    contact.priority = newPriority;
    await this.save(userId, contacts);
    return true;
  }

  async getByPriority(userId: string, priority: number): Promise<EmergencyContact | null> {
    const contacts = await this.getContacts(userId);
    return contacts.find(c => c.priority === priority) ?? null;
  }

  private async save(userId: string, contacts: EmergencyContact[]): Promise<void> {
    try { const redis = getRedis(); await redis.set(EC_PREFIX + userId, JSON.stringify(contacts), { EX: EC_TTL }); }
    catch (err) { log.warn('Failed to save contacts', { error: (err as Error).message }); }
  }
}

export const userEmergencyContact = new UserEmergencyContactService();
