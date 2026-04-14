const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserFavoriteMerchantService } from '../../src/services/user-favorite-merchant.service';

describe('UserFavoriteMerchantService', () => {
  let s: UserFavoriteMerchantService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserFavoriteMerchantService(); mockRedisGet.mockResolvedValue(null); });

  const base = {
    userId: 'u1',
    merchantId: 'm1',
    merchantName: 'Cafe Central',
    category: 'Cafeteria',
  };

  it('adds favorite', async () => {
    const f = await s.add(base);
    expect(f.pinned).toBe(false);
    expect(f.totalSpent).toBe(0);
  });

  it('rejects duplicate', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ merchantId: 'm1' }]));
    await expect(s.add(base)).rejects.toThrow('ya esta');
  });

  it('rejects over 50 favorites', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ merchantId: 'other' + i }))));
    await expect(s.add(base)).rejects.toThrow('50');
  });

  it('removes favorite', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ merchantId: 'm1' }, { merchantId: 'm2' }]));
    expect(await s.remove('u1', 'm1')).toBe(true);
  });

  it('toggles pin', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ merchantId: 'm1', pinned: false }]));
    const f = await s.togglePin('u1', 'm1');
    expect(f?.pinned).toBe(true);
  });

  it('rejects pinning over 5', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { merchantId: 'm1', pinned: false },
      ...Array.from({ length: 5 }, (_, i) => ({ merchantId: 'p' + i, pinned: true })),
    ]));
    await expect(s.togglePin('u1', 'm1')).rejects.toThrow('5');
  });

  it('allows unpin when at limit', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(Array.from({ length: 5 }, (_, i) => ({
      merchantId: 'm' + i, pinned: true,
    }))));
    const f = await s.togglePin('u1', 'm0');
    expect(f?.pinned).toBe(false);
  });

  it('records payment', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      merchantId: 'm1', totalSpent: 5000, transactionCount: 2,
    }]));
    const f = await s.recordPayment('u1', 'm1', 3000);
    expect(f?.totalSpent).toBe(8000);
    expect(f?.transactionCount).toBe(3);
  });

  it('rejects zero payment', async () => {
    await expect(s.recordPayment('u1', 'm1', 0)).rejects.toThrow('positivo');
  });

  it('returns pinned', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { merchantId: 'm1', pinned: true },
      { merchantId: 'm2', pinned: false },
      { merchantId: 'm3', pinned: true },
    ]));
    expect((await s.getPinned('u1'))).toHaveLength(2);
  });

  it('returns most spent sorted', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { merchantId: 'm1', totalSpent: 10000 },
      { merchantId: 'm2', totalSpent: 50000 },
      { merchantId: 'm3', totalSpent: 25000 },
    ]));
    const top = await s.getMostSpent('u1', 2);
    expect(top[0].merchantId).toBe('m2');
    expect(top[1].merchantId).toBe('m3');
  });

  it('filters by category', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { category: 'Cafeteria' }, { category: 'Retail' }, { category: 'Cafeteria' },
    ]));
    expect((await s.getByCategory('u1', 'Cafeteria'))).toHaveLength(2);
  });

  it('checks isFavorite', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ merchantId: 'm1' }]));
    expect(await s.isFavorite('u1', 'm1')).toBe(true);
    expect(await s.isFavorite('u1', 'm99')).toBe(false);
  });
});
