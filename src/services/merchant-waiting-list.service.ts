import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('waiting-list');
const WL_PREFIX = 'waitlist:';
const WL_TTL = 180 * 24 * 60 * 60;

export type WaitStatus = 'WAITING' | 'NOTIFIED' | 'CONVERTED' | 'CANCELLED';

export interface WaitEntry {
  id: string;
  merchantId: string;
  customerPhone: string;
  productId: string;
  productName: string;
  status: WaitStatus;
  position: number;
  notifiedAt: string | null;
  createdAt: string;
}

export class MerchantWaitingListService {
  async addToWaitlist(input: { merchantId: string; customerPhone: string; productId: string; productName: string }): Promise<WaitEntry> {
    const entries = await this.getWaitlist(input.merchantId, input.productId);
    const existing = entries.find(e => e.customerPhone === input.customerPhone && e.status === 'WAITING');
    if (existing) throw new Error('Ya estas en la lista de espera.');

    const entry: WaitEntry = {
      id: 'wait_' + Date.now().toString(36),
      merchantId: input.merchantId,
      customerPhone: input.customerPhone,
      productId: input.productId,
      productName: input.productName,
      status: 'WAITING',
      position: entries.filter(e => e.status === 'WAITING').length + 1,
      notifiedAt: null,
      createdAt: new Date().toISOString(),
    };
    entries.push(entry);
    await this.save(input.merchantId, input.productId, entries);
    return entry;
  }

  async getWaitlist(merchantId: string, productId: string): Promise<WaitEntry[]> {
    try { const redis = getRedis(); const raw = await redis.get(WL_PREFIX + merchantId + ':' + productId); return raw ? JSON.parse(raw) as WaitEntry[] : []; }
    catch { return []; }
  }

  async notifyNext(merchantId: string, productId: string, count: number): Promise<WaitEntry[]> {
    const entries = await this.getWaitlist(merchantId, productId);
    const waiting = entries.filter(e => e.status === 'WAITING').slice(0, count);
    for (const e of waiting) {
      e.status = 'NOTIFIED';
      e.notifiedAt = new Date().toISOString();
    }
    await this.save(merchantId, productId, entries);
    return waiting;
  }

  async markConverted(merchantId: string, productId: string, entryId: string): Promise<boolean> {
    const entries = await this.getWaitlist(merchantId, productId);
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return false;
    entry.status = 'CONVERTED';
    await this.save(merchantId, productId, entries);
    return true;
  }

  async cancelEntry(merchantId: string, productId: string, entryId: string): Promise<boolean> {
    const entries = await this.getWaitlist(merchantId, productId);
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return false;
    entry.status = 'CANCELLED';
    await this.save(merchantId, productId, entries);
    return true;
  }

  async getStats(merchantId: string, productId: string): Promise<{ waiting: number; notified: number; converted: number }> {
    const entries = await this.getWaitlist(merchantId, productId);
    return {
      waiting: entries.filter(e => e.status === 'WAITING').length,
      notified: entries.filter(e => e.status === 'NOTIFIED').length,
      converted: entries.filter(e => e.status === 'CONVERTED').length,
    };
  }

  private async save(merchantId: string, productId: string, entries: WaitEntry[]): Promise<void> {
    try { const redis = getRedis(); await redis.set(WL_PREFIX + merchantId + ':' + productId, JSON.stringify(entries), { EX: WL_TTL }); }
    catch (err) { log.warn('Failed to save waitlist', { error: (err as Error).message }); }
  }
}

export const merchantWaitingList = new MerchantWaitingListService();
