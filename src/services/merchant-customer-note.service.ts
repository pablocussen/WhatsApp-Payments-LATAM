import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('customer-note');
const CN_PREFIX = 'custnote:';
const CN_TTL = 365 * 24 * 60 * 60;
const MAX_NOTES = 20;

export type NotePriority = 'LOW' | 'NORMAL' | 'HIGH';

export interface CustomerNote {
  id: string;
  merchantId: string;
  customerPhone: string;
  content: string;
  priority: NotePriority;
  createdBy: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export class MerchantCustomerNoteService {
  async addNote(input: {
    merchantId: string; customerPhone: string; content: string;
    priority?: NotePriority; createdBy: string; tags?: string[];
  }): Promise<CustomerNote> {
    if (!input.content || input.content.length > 500) throw new Error('Contenido entre 1 y 500 caracteres.');

    const notes = await this.getNotes(input.merchantId, input.customerPhone);
    if (notes.length >= MAX_NOTES) throw new Error('Maximo ' + MAX_NOTES + ' notas por cliente.');

    const note: CustomerNote = {
      id: 'note_' + Date.now().toString(36),
      merchantId: input.merchantId,
      customerPhone: input.customerPhone,
      content: input.content,
      priority: input.priority ?? 'NORMAL',
      createdBy: input.createdBy,
      tags: input.tags ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    notes.push(note);
    await this.save(input.merchantId, input.customerPhone, notes);
    return note;
  }

  async getNotes(merchantId: string, customerPhone: string): Promise<CustomerNote[]> {
    try { const redis = getRedis(); const raw = await redis.get(CN_PREFIX + merchantId + ':' + customerPhone); return raw ? JSON.parse(raw) as CustomerNote[] : []; }
    catch { return []; }
  }

  async getHighPriority(merchantId: string, customerPhone: string): Promise<CustomerNote[]> {
    const notes = await this.getNotes(merchantId, customerPhone);
    return notes.filter(n => n.priority === 'HIGH');
  }

  async searchByTag(merchantId: string, customerPhone: string, tag: string): Promise<CustomerNote[]> {
    const notes = await this.getNotes(merchantId, customerPhone);
    return notes.filter(n => n.tags.includes(tag));
  }

  async updateNote(merchantId: string, customerPhone: string, noteId: string, updates: { content?: string; priority?: NotePriority; tags?: string[] }): Promise<CustomerNote | null> {
    const notes = await this.getNotes(merchantId, customerPhone);
    const note = notes.find(n => n.id === noteId);
    if (!note) return null;

    if (updates.content !== undefined) {
      if (updates.content.length > 500) throw new Error('Contenido maximo 500 caracteres.');
      note.content = updates.content;
    }
    if (updates.priority !== undefined) note.priority = updates.priority;
    if (updates.tags !== undefined) note.tags = updates.tags;
    note.updatedAt = new Date().toISOString();
    await this.save(merchantId, customerPhone, notes);
    return note;
  }

  async deleteNote(merchantId: string, customerPhone: string, noteId: string): Promise<boolean> {
    const notes = await this.getNotes(merchantId, customerPhone);
    const filtered = notes.filter(n => n.id !== noteId);
    if (filtered.length === notes.length) return false;
    await this.save(merchantId, customerPhone, filtered);
    return true;
  }

  private async save(merchantId: string, customerPhone: string, notes: CustomerNote[]): Promise<void> {
    try { const redis = getRedis(); await redis.set(CN_PREFIX + merchantId + ':' + customerPhone, JSON.stringify(notes), { EX: CN_TTL }); }
    catch (err) { log.warn('Failed to save notes', { error: (err as Error).message }); }
  }
}

export const merchantCustomerNote = new MerchantCustomerNoteService();
