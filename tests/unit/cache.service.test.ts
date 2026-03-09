/**
 * Tests for CacheService — Redis caching layer.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisDel = jest.fn().mockResolvedValue(1);

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
  }),
}));

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test' },
}));

import { CacheService, cache } from '../../src/services/cache.service';

describe('CacheService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── Balance ──────────────────────────────────────────

  describe('balance cache', () => {
    it('getBalance returns cached value', async () => {
      mockRedisGet.mockResolvedValue('50000');
      const result = await cache.getBalance('user-1');
      expect(result).toBe(50000);
      expect(mockRedisGet).toHaveBeenCalledWith('cache:balance:user-1');
    });

    it('getBalance returns null on cache miss', async () => {
      mockRedisGet.mockResolvedValue(null);
      const result = await cache.getBalance('user-1');
      expect(result).toBeNull();
    });

    it('getBalance returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const result = await cache.getBalance('user-1');
      expect(result).toBeNull();
    });

    it('setBalance stores with 30s TTL', async () => {
      await cache.setBalance('user-1', 50000);
      expect(mockRedisSet).toHaveBeenCalledWith('cache:balance:user-1', '50000', { EX: 30 });
    });

    it('setBalance fails silently', async () => {
      mockRedisSet.mockRejectedValue(new Error('Redis down'));
      await cache.setBalance('user-1', 50000); // should not throw
    });

    it('invalidateBalance deletes cache keys', async () => {
      await cache.invalidateBalance('user-1', 'user-2');
      expect(mockRedisDel).toHaveBeenCalledWith(['cache:balance:user-1', 'cache:balance:user-2']);
    });

    it('invalidateBalance fails silently', async () => {
      mockRedisDel.mockRejectedValue(new Error('Redis down'));
      await cache.invalidateBalance('user-1'); // should not throw
    });
  });

  // ─── User Profile ─────────────────────────────────────

  describe('user profile cache', () => {
    const userJson = JSON.stringify({ id: 'u1', waId: '+56912345678', name: 'Test' });

    it('getUser returns cached JSON', async () => {
      mockRedisGet.mockResolvedValue(userJson);
      const result = await cache.getUser('waId', '+56912345678');
      expect(result).toBe(userJson);
      expect(mockRedisGet).toHaveBeenCalledWith('cache:user:waId:+56912345678');
    });

    it('getUser returns null on miss', async () => {
      mockRedisGet.mockResolvedValue(null);
      const result = await cache.getUser('id', 'u1');
      expect(result).toBeNull();
    });

    it('getUser returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const result = await cache.getUser('id', 'u1');
      expect(result).toBeNull();
    });

    it('setUser stores with both keys', async () => {
      await cache.setUser('u1', '+56912345678', userJson);
      expect(mockRedisSet).toHaveBeenCalledWith('cache:user:id:u1', userJson, { EX: 300 });
      expect(mockRedisSet).toHaveBeenCalledWith('cache:user:waId:+56912345678', userJson, { EX: 300 });
    });

    it('setUser fails silently', async () => {
      mockRedisSet.mockRejectedValue(new Error('Redis down'));
      await cache.setUser('u1', '+56912345678', userJson); // should not throw
    });

    it('invalidateUser deletes both keys', async () => {
      await cache.invalidateUser('u1', '+56912345678');
      expect(mockRedisDel).toHaveBeenCalledWith(['cache:user:id:u1', 'cache:user:waId:+56912345678']);
    });

    it('invalidateUser fails silently', async () => {
      mockRedisDel.mockRejectedValue(new Error('Redis down'));
      await cache.invalidateUser('u1', '+56912345678'); // should not throw
    });
  });

  // ─── Recent Recipients ────────────────────────────────

  describe('recipients cache', () => {
    const recipientsJson = JSON.stringify([{ id: 'r1', name: 'Juan', waId: '+56911111111' }]);

    it('getRecipients returns cached JSON', async () => {
      mockRedisGet.mockResolvedValue(recipientsJson);
      const result = await cache.getRecipients('user-1');
      expect(result).toBe(recipientsJson);
      expect(mockRedisGet).toHaveBeenCalledWith('cache:recipients:user-1');
    });

    it('getRecipients returns null on miss', async () => {
      mockRedisGet.mockResolvedValue(null);
      const result = await cache.getRecipients('user-1');
      expect(result).toBeNull();
    });

    it('getRecipients returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const result = await cache.getRecipients('user-1');
      expect(result).toBeNull();
    });

    it('setRecipients stores with 5min TTL', async () => {
      await cache.setRecipients('user-1', recipientsJson);
      expect(mockRedisSet).toHaveBeenCalledWith('cache:recipients:user-1', recipientsJson, { EX: 300 });
    });

    it('setRecipients fails silently', async () => {
      mockRedisSet.mockRejectedValue(new Error('Redis down'));
      await cache.setRecipients('user-1', recipientsJson); // should not throw
    });

    it('invalidateRecipients deletes key', async () => {
      await cache.invalidateRecipients('user-1');
      expect(mockRedisDel).toHaveBeenCalledWith('cache:recipients:user-1');
    });

    it('invalidateRecipients fails silently', async () => {
      mockRedisDel.mockRejectedValue(new Error('Redis down'));
      await cache.invalidateRecipients('user-1'); // should not throw
    });
  });

  // ─── Singleton ────────────────────────────────────────

  it('exports a singleton instance', () => {
    expect(cache).toBeInstanceOf(CacheService);
  });
});
