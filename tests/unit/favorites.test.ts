/**
 * FavoritesService — quick-pay favorite contacts.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { FavoritesService } from '../../src/services/favorites.service';

describe('FavoritesService', () => {
  let service: FavoritesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new FavoritesService();
    mockRedisGet.mockResolvedValue(null);
  });

  // ── addFavorite ───────────────────────────────────

  it('adds a new favorite', async () => {
    const fav = await service.addFavorite('owner-1', {
      userId: 'user-2', name: 'Juan', phone: '56912345678',
    });
    expect(fav.name).toBe('Juan');
    expect(fav.payCount).toBe(0);
    expect(fav.addedAt).toBeTruthy();
  });

  it('updates existing favorite name', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { userId: 'user-2', name: 'Juan', phone: '56912345678', payCount: 5, totalPaid: 25000, addedAt: '2026-01-01' },
    ]));

    const fav = await service.addFavorite('owner-1', {
      userId: 'user-2', name: 'Juanito', phone: '56912345678',
    });
    expect(fav.name).toBe('Juanito');
  });

  it('rejects more than 10 favorites', async () => {
    const existing = Array.from({ length: 10 }, (_, i) => ({
      userId: `u-${i}`, name: `User ${i}`, phone: `5691${i}`, payCount: 0, totalPaid: 0, addedAt: '',
    }));
    mockRedisGet.mockResolvedValue(JSON.stringify(existing));

    await expect(service.addFavorite('owner-1', {
      userId: 'u-new', name: 'New', phone: '56900000000',
    })).rejects.toThrow('10');
  });

  // ── removeFavorite ────────────────────────────────

  it('removes a favorite', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { userId: 'user-2', name: 'Juan', payCount: 0 },
      { userId: 'user-3', name: 'María', payCount: 0 },
    ]));

    const result = await service.removeFavorite('owner-1', 'user-2');
    expect(result).toBe(true);

    const stored = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(stored).toHaveLength(1);
    expect(stored[0].userId).toBe('user-3');
  });

  it('returns false for non-existent favorite', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([]));
    const result = await service.removeFavorite('owner-1', 'nonexistent');
    expect(result).toBe(false);
  });

  // ── getFavorites ──────────────────────────────────

  it('returns empty array for new user', async () => {
    const favs = await service.getFavorites('owner-1');
    expect(favs).toEqual([]);
  });

  it('sorts by most used', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { userId: 'u1', name: 'A', payCount: 2 },
      { userId: 'u2', name: 'B', payCount: 10 },
      { userId: 'u3', name: 'C', payCount: 5 },
    ]));

    const favs = await service.getFavorites('owner-1');
    expect(favs[0].name).toBe('B');  // 10 pays
    expect(favs[1].name).toBe('C');  // 5 pays
    expect(favs[2].name).toBe('A');  // 2 pays
  });

  // ── recordPayment ─────────────────────────────────

  it('updates pay count and total', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { userId: 'user-2', name: 'Juan', payCount: 3, totalPaid: 15000, lastPaidAt: null, addedAt: '' },
    ]));

    await service.recordPayment('owner-1', 'user-2', 5000);

    const stored = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(stored[0].payCount).toBe(4);
    expect(stored[0].totalPaid).toBe(20000);
    expect(stored[0].lastPaidAt).toBeTruthy();
  });

  it('does nothing for non-favorite', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([]));
    await service.recordPayment('owner-1', 'unknown', 5000);
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  // ── shouldSuggestFavorite ─────────────────────────

  it('suggests after 3+ payments', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([]));
    expect(await service.shouldSuggestFavorite('owner-1', 'user-2', 3)).toBe(true);
    expect(await service.shouldSuggestFavorite('owner-1', 'user-2', 2)).toBe(false);
  });

  it('does not suggest if already favorite', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { userId: 'user-2', payCount: 0 },
    ]));
    expect(await service.shouldSuggestFavorite('owner-1', 'user-2', 5)).toBe(false);
  });
});
