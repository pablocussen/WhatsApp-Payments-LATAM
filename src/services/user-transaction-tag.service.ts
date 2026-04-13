import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-transaction-tag');
const PREFIX = 'user:tx-tag:';
const TTL = 365 * 24 * 60 * 60;

export interface TransactionTag {
  transactionId: string;
  tags: string[];
  updatedAt: string;
}

export class UserTransactionTagService {
  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  async list(userId: string): Promise<TransactionTag[]> {
    const raw = await getRedis().get(this.key(userId));
    return raw ? JSON.parse(raw) : [];
  }

  private normalize(tag: string): string {
    return tag.trim().toLowerCase().replace(/\s+/g, '-');
  }

  async setTags(userId: string, transactionId: string, tags: string[]): Promise<TransactionTag> {
    if (tags.length > 10) throw new Error('Maximo 10 tags por transaccion');
    const clean = Array.from(new Set(tags.map(t => this.normalize(t)).filter(t => t.length > 0 && t.length <= 30)));
    const list = await this.list(userId);
    const existing = list.find(t => t.transactionId === transactionId);
    if (existing) {
      existing.tags = clean;
      existing.updatedAt = new Date().toISOString();
    } else {
      list.push({ transactionId, tags: clean, updatedAt: new Date().toISOString() });
    }
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    log.info('tags set', { userId, transactionId });
    return list.find(t => t.transactionId === transactionId)!;
  }

  async addTag(userId: string, transactionId: string, tag: string): Promise<TransactionTag> {
    const list = await this.list(userId);
    let entry = list.find(t => t.transactionId === transactionId);
    const normalized = this.normalize(tag);
    if (!normalized || normalized.length > 30) throw new Error('Tag invalido');
    if (!entry) {
      entry = { transactionId, tags: [normalized], updatedAt: new Date().toISOString() };
      list.push(entry);
    } else {
      if (entry.tags.length >= 10) throw new Error('Maximo 10 tags');
      if (!entry.tags.includes(normalized)) entry.tags.push(normalized);
      entry.updatedAt = new Date().toISOString();
    }
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return entry;
  }

  async removeTag(userId: string, transactionId: string, tag: string): Promise<boolean> {
    const list = await this.list(userId);
    const entry = list.find(t => t.transactionId === transactionId);
    if (!entry) return false;
    const normalized = this.normalize(tag);
    const before = entry.tags.length;
    entry.tags = entry.tags.filter(t => t !== normalized);
    if (entry.tags.length === before) return false;
    entry.updatedAt = new Date().toISOString();
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return true;
  }

  async findByTag(userId: string, tag: string): Promise<string[]> {
    const list = await this.list(userId);
    const normalized = this.normalize(tag);
    return list.filter(t => t.tags.includes(normalized)).map(t => t.transactionId);
  }

  async getAllTags(userId: string): Promise<{ tag: string; count: number }[]> {
    const list = await this.list(userId);
    const counts = new Map<string, number>();
    for (const t of list) {
      for (const tag of t.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }
}

export const userTransactionTag = new UserTransactionTagService();
