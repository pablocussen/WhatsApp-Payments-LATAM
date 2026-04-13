import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-wishlist');
const PREFIX = 'user:wishlist:';
const TTL = 365 * 24 * 60 * 60;

export type Priority = 'LOW' | 'MEDIUM' | 'HIGH';

export interface WishlistItem {
  id: string;
  userId: string;
  name: string;
  targetPrice: number;
  savedSoFar: number;
  priority: Priority;
  notes?: string;
  createdAt: string;
  purchasedAt?: string;
}

export class UserWishlistService {
  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  async list(userId: string): Promise<WishlistItem[]> {
    const raw = await getRedis().get(this.key(userId));
    return raw ? JSON.parse(raw) : [];
  }

  async add(input: {
    userId: string;
    name: string;
    targetPrice: number;
    priority?: Priority;
    notes?: string;
  }): Promise<WishlistItem> {
    if (input.targetPrice <= 0) throw new Error('Precio debe ser positivo');
    if (input.name.length > 80) throw new Error('Nombre excede 80 caracteres');
    const list = await this.list(input.userId);
    const active = list.filter(i => !i.purchasedAt);
    if (active.length >= 20) throw new Error('Maximo 20 items activos en wishlist');
    const item: WishlistItem = {
      id: `wish_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: input.userId,
      name: input.name,
      targetPrice: input.targetPrice,
      savedSoFar: 0,
      priority: input.priority ?? 'MEDIUM',
      notes: input.notes,
      createdAt: new Date().toISOString(),
    };
    list.push(item);
    await getRedis().set(this.key(input.userId), JSON.stringify(list), { EX: TTL });
    log.info('wishlist item added', { id: item.id });
    return item;
  }

  async addSaving(userId: string, id: string, amount: number): Promise<WishlistItem | null> {
    if (amount <= 0) throw new Error('Monto debe ser positivo');
    const list = await this.list(userId);
    const item = list.find(i => i.id === id);
    if (!item || item.purchasedAt) return null;
    item.savedSoFar = Math.min(item.targetPrice, item.savedSoFar + amount);
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return item;
  }

  async markPurchased(userId: string, id: string): Promise<WishlistItem | null> {
    const list = await this.list(userId);
    const item = list.find(i => i.id === id);
    if (!item || item.purchasedAt) return null;
    item.purchasedAt = new Date().toISOString();
    item.savedSoFar = item.targetPrice;
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return item;
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const list = await this.list(userId);
    const idx = list.findIndex(i => i.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return true;
  }

  async getByPriority(userId: string): Promise<WishlistItem[]> {
    const list = await this.list(userId);
    const order: Record<Priority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    return list
      .filter(i => !i.purchasedAt)
      .sort((a, b) => order[a.priority] - order[b.priority]);
  }

  computeProgress(item: WishlistItem): number {
    if (item.targetPrice === 0) return 0;
    return Math.round((item.savedSoFar / item.targetPrice) * 100);
  }
}

export const userWishlist = new UserWishlistService();
