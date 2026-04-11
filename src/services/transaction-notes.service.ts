import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('tx-notes');

const NOTES_PREFIX = 'txnote:';
const NOTES_TTL = 365 * 24 * 60 * 60;
const MAX_NOTE_LENGTH = 200;
const MAX_NOTES_PER_TX = 5;

export interface TransactionNote {
  id: string;
  transactionRef: string;
  userId: string;
  text: string;
  createdAt: string;
}

export class TransactionNotesService {
  async addNote(userId: string, transactionRef: string, text: string): Promise<TransactionNote> {
    if (!text || text.length > MAX_NOTE_LENGTH) {
      throw new Error(`Nota debe tener entre 1 y ${MAX_NOTE_LENGTH} caracteres.`);
    }

    const notes = await this.getNotes(userId, transactionRef);
    if (notes.length >= MAX_NOTES_PER_TX) {
      throw new Error(`Máximo ${MAX_NOTES_PER_TX} notas por transacción.`);
    }

    const note: TransactionNote = {
      id: `note_${Date.now().toString(36)}`,
      transactionRef,
      userId,
      text,
      createdAt: new Date().toISOString(),
    };

    notes.push(note);
    await this.save(userId, transactionRef, notes);

    log.info('Note added', { userId, transactionRef, noteId: note.id });
    return note;
  }

  async getNotes(userId: string, transactionRef: string): Promise<TransactionNote[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${NOTES_PREFIX}${userId}:${transactionRef}`);
      return raw ? JSON.parse(raw) as TransactionNote[] : [];
    } catch {
      return [];
    }
  }

  async deleteNote(userId: string, transactionRef: string, noteId: string): Promise<boolean> {
    const notes = await this.getNotes(userId, transactionRef);
    const filtered = notes.filter(n => n.id !== noteId);
    if (filtered.length === notes.length) return false;
    await this.save(userId, transactionRef, filtered);
    return true;
  }

  async editNote(userId: string, transactionRef: string, noteId: string, newText: string): Promise<TransactionNote | null> {
    if (!newText || newText.length > MAX_NOTE_LENGTH) {
      throw new Error(`Nota debe tener entre 1 y ${MAX_NOTE_LENGTH} caracteres.`);
    }

    const notes = await this.getNotes(userId, transactionRef);
    const note = notes.find(n => n.id === noteId);
    if (!note) return null;

    note.text = newText;
    await this.save(userId, transactionRef, notes);
    return note;
  }

  private async save(userId: string, transactionRef: string, notes: TransactionNote[]): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${NOTES_PREFIX}${userId}:${transactionRef}`, JSON.stringify(notes), { EX: NOTES_TTL });
    } catch (err) {
      log.warn('Failed to save notes', { userId, transactionRef, error: (err as Error).message });
    }
  }
}

export const transactionNotes = new TransactionNotesService();
