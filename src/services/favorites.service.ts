import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('favorites');

const FAV_PREFIX = 'fav:';
const FAV_TTL = 365 * 24 * 60 * 60;
const MAX_FAVORITES = 10;

export interface Favorite {
  userId: string;
  name: string;
  phone: string;
  lastPaidAt: string | null;
  payCount: number;
  totalPaid: number;
  addedAt: string;
}

export class FavoritesService {
  /**
   * Add or update a favorite contact.
   */
  async addFavorite(ownerId: string, favorite: {
    userId: string;
    name: string;
    phone: string;
  }): Promise<Favorite> {
    const favorites = await this.getFavorites(ownerId);

    const existing = favorites.find(f => f.userId === favorite.userId);
    if (existing) {
      existing.name = favorite.name;
      existing.phone = favorite.phone;
    } else {
      if (favorites.length >= MAX_FAVORITES) {
        throw new Error(`Máximo ${MAX_FAVORITES} favoritos. Elimina uno primero.`);
      }
      favorites.push({
        userId: favorite.userId,
        name: favorite.name,
        phone: favorite.phone,
        lastPaidAt: null,
        payCount: 0,
        totalPaid: 0,
        addedAt: new Date().toISOString(),
      });
    }

    await this.saveFavorites(ownerId, favorites);
    return favorites.find(f => f.userId === favorite.userId)!;
  }

  /**
   * Remove a favorite.
   */
  async removeFavorite(ownerId: string, favoriteUserId: string): Promise<boolean> {
    const favorites = await this.getFavorites(ownerId);
    const before = favorites.length;
    const filtered = favorites.filter(f => f.userId !== favoriteUserId);

    if (filtered.length === before) return false;

    await this.saveFavorites(ownerId, filtered);
    return true;
  }

  /**
   * Get all favorites for a user, sorted by most used.
   */
  async getFavorites(ownerId: string): Promise<Favorite[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${FAV_PREFIX}${ownerId}`);
      if (!raw) return [];
      const favorites = JSON.parse(raw) as Favorite[];
      return favorites.sort((a, b) => b.payCount - a.payCount);
    } catch {
      return [];
    }
  }

  /**
   * Record a payment to a favorite (updates stats).
   */
  async recordPayment(ownerId: string, favoriteUserId: string, amount: number): Promise<void> {
    const favorites = await this.getFavorites(ownerId);
    const fav = favorites.find(f => f.userId === favoriteUserId);
    if (!fav) return;

    fav.payCount++;
    fav.totalPaid += amount;
    fav.lastPaidAt = new Date().toISOString();

    await this.saveFavorites(ownerId, favorites);
  }

  /**
   * Auto-suggest adding a contact as favorite after 3+ payments.
   */
  async shouldSuggestFavorite(ownerId: string, contactUserId: string, payCount: number): Promise<boolean> {
    if (payCount < 3) return false;
    const favorites = await this.getFavorites(ownerId);
    return !favorites.some(f => f.userId === contactUserId);
  }

  private async saveFavorites(ownerId: string, favorites: Favorite[]): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${FAV_PREFIX}${ownerId}`, JSON.stringify(favorites), { EX: FAV_TTL });
    } catch (err) {
      log.warn('Failed to save favorites', { ownerId, error: (err as Error).message });
    }
  }
}

export const favorites = new FavoritesService();
