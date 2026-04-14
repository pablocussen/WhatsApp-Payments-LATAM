import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-favorite-merchant');
const PREFIX = 'user:fav-merchant:';
const TTL = 365 * 24 * 60 * 60;

export interface FavoriteMerchant {
  merchantId: string;
  merchantName: string;
  category: string;
  logoUrl?: string;
  lastPaidAt?: string;
  totalSpent: number;
  transactionCount: number;
  addedAt: string;
  pinned: boolean;
}

export class UserFavoriteMerchantService {
  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  async list(userId: string): Promise<FavoriteMerchant[]> {
    const raw = await getRedis().get(this.key(userId));
    return raw ? JSON.parse(raw) : [];
  }

  async add(input: {
    userId: string;
    merchantId: string;
    merchantName: string;
    category: string;
    logoUrl?: string;
  }): Promise<FavoriteMerchant> {
    if (input.merchantName.length > 80) throw new Error('Nombre excede 80 caracteres');
    if (input.category.length > 40) throw new Error('Categoria excede 40 caracteres');
    const list = await this.list(input.userId);
    if (list.some(f => f.merchantId === input.merchantId)) {
      throw new Error('Comercio ya esta en favoritos');
    }
    if (list.length >= 50) throw new Error('Maximo 50 favoritos');
    const fav: FavoriteMerchant = {
      merchantId: input.merchantId,
      merchantName: input.merchantName,
      category: input.category,
      logoUrl: input.logoUrl,
      totalSpent: 0,
      transactionCount: 0,
      addedAt: new Date().toISOString(),
      pinned: false,
    };
    list.push(fav);
    await getRedis().set(this.key(input.userId), JSON.stringify(list), { EX: TTL });
    log.info('favorite added', { userId: input.userId, merchantId: input.merchantId });
    return fav;
  }

  async remove(userId: string, merchantId: string): Promise<boolean> {
    const list = await this.list(userId);
    const idx = list.findIndex(f => f.merchantId === merchantId);
    if (idx === -1) return false;
    list.splice(idx, 1);
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return true;
  }

  async togglePin(userId: string, merchantId: string): Promise<FavoriteMerchant | null> {
    const list = await this.list(userId);
    const fav = list.find(f => f.merchantId === merchantId);
    if (!fav) return null;
    if (!fav.pinned) {
      const pinnedCount = list.filter(f => f.pinned).length;
      if (pinnedCount >= 5) throw new Error('Maximo 5 comercios pinneados');
    }
    fav.pinned = !fav.pinned;
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return fav;
  }

  async recordPayment(userId: string, merchantId: string, amount: number): Promise<FavoriteMerchant | null> {
    if (amount <= 0) throw new Error('Monto debe ser positivo');
    const list = await this.list(userId);
    const fav = list.find(f => f.merchantId === merchantId);
    if (!fav) return null;
    fav.totalSpent += amount;
    fav.transactionCount++;
    fav.lastPaidAt = new Date().toISOString();
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return fav;
  }

  async getPinned(userId: string): Promise<FavoriteMerchant[]> {
    const list = await this.list(userId);
    return list.filter(f => f.pinned);
  }

  async getMostSpent(userId: string, limit = 10): Promise<FavoriteMerchant[]> {
    const list = await this.list(userId);
    return [...list]
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, limit);
  }

  async getByCategory(userId: string, category: string): Promise<FavoriteMerchant[]> {
    const list = await this.list(userId);
    return list.filter(f => f.category === category);
  }

  async isFavorite(userId: string, merchantId: string): Promise<boolean> {
    const list = await this.list(userId);
    return list.some(f => f.merchantId === merchantId);
  }
}

export const userFavoriteMerchant = new UserFavoriteMerchantService();
