const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserWishlistService } from '../../src/services/user-wishlist.service';

describe('UserWishlistService', () => {
  let s: UserWishlistService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserWishlistService(); mockRedisGet.mockResolvedValue(null); });

  it('adds item', async () => {
    const i = await s.add({ userId: 'u1', name: 'iPhone 15', targetPrice: 900000, priority: 'HIGH' });
    expect(i.priority).toBe('HIGH');
    expect(i.savedSoFar).toBe(0);
  });

  it('defaults priority MEDIUM', async () => {
    const i = await s.add({ userId: 'u1', name: 'x', targetPrice: 1000 });
    expect(i.priority).toBe('MEDIUM');
  });

  it('rejects zero price', async () => {
    await expect(s.add({ userId: 'u1', name: 'x', targetPrice: 0 })).rejects.toThrow('positivo');
  });

  it('rejects over 20 active', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ id: 'w' + i }))));
    await expect(s.add({ userId: 'u1', name: 'x', targetPrice: 100 })).rejects.toThrow('20');
  });

  it('adds saving capped at target', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'w1', targetPrice: 1000, savedSoFar: 900 }]));
    const i = await s.addSaving('u1', 'w1', 500);
    expect(i?.savedSoFar).toBe(1000);
  });

  it('rejects negative saving', async () => {
    await expect(s.addSaving('u1', 'w1', -100)).rejects.toThrow('positivo');
  });

  it('marks as purchased', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'w1', targetPrice: 1000, savedSoFar: 500 }]));
    const i = await s.markPurchased('u1', 'w1');
    expect(i?.purchasedAt).toBeDefined();
    expect(i?.savedSoFar).toBe(1000);
  });

  it('removes item', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'w1' }, { id: 'w2' }]));
    expect(await s.remove('u1', 'w1')).toBe(true);
  });

  it('sorts by priority', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'w1', priority: 'LOW' },
      { id: 'w2', priority: 'HIGH' },
      { id: 'w3', priority: 'MEDIUM' },
    ]));
    const sorted = await s.getByPriority('u1');
    expect(sorted[0].priority).toBe('HIGH');
    expect(sorted[2].priority).toBe('LOW');
  });

  it('computes progress percentage', () => {
    const p = s.computeProgress({ id: 'w1', userId: 'u1', name: 'x', targetPrice: 1000, savedSoFar: 250, priority: 'HIGH', createdAt: '' });
    expect(p).toBe(25);
  });
});
