/**
 * Unit tests for ApiKeyService.
 * Redis is fully mocked.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisDel = jest.fn().mockResolvedValue(1);

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test' },
}));

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
  }),
}));

import { ApiKeyService } from '../../src/services/api-key.service';
import type { ApiKey } from '../../src/services/api-key.service';

describe('ApiKeyService', () => {
  let svc: ApiKeyService;

  beforeEach(() => {
    svc = new ApiKeyService();
    jest.clearAllMocks();
    mockRedisGet.mockResolvedValue(null);
    mockRedisSet.mockResolvedValue('OK');
    mockRedisDel.mockResolvedValue(1);
  });

  // ─── createKey ─────────────────────────────────────────

  describe('createKey', () => {
    it('creates a key with wp_live_ prefix', async () => {
      const result = await svc.createKey('m-1', 'Producción', ['payments:read']);
      expect(result.key).toMatch(/^wp_live_[0-9a-f]{48}$/);
      expect(result.keyPrefix).toMatch(/^wp_live_[0-9a-f]{8}$/);
      expect(result.name).toBe('Producción');
      expect(result.permissions).toEqual(['payments:read']);
      expect(result.id).toHaveLength(16); // 8 bytes hex
    });

    it('stores key hash in Redis, not raw key', async () => {
      const result = await svc.createKey('m-1', 'Test', ['payments:read']);
      const storedKeys = JSON.parse(mockRedisSet.mock.calls[0][1]) as ApiKey[];
      expect(storedKeys[0].keyHash).toHaveLength(64); // SHA-256 hex
      expect(storedKeys[0].keyHash).not.toContain('wp_live_');
      expect(result.key).toContain('wp_live_');
    });

    it('creates reverse lookup entry', async () => {
      await svc.createKey('m-1', 'Test', ['payments:read']);
      // Second set call is the lookup
      expect(mockRedisSet).toHaveBeenCalledTimes(2);
      const lookupKey = mockRedisSet.mock.calls[1][0] as string;
      expect(lookupKey).toMatch(/^apikeys:lookup:[0-9a-f]{64}$/);
    });

    it('rejects when max keys reached', async () => {
      const existing: ApiKey[] = Array.from({ length: 5 }, (_, i) => ({
        id: `key-${i}`, name: `Key ${i}`, keyPrefix: 'wp_live_xxxx',
        keyHash: `hash${i}`, merchantId: 'm-1', permissions: ['payments:read' as const],
        createdAt: '2026-01-01', lastUsedAt: null, active: true,
      }));
      mockRedisGet.mockResolvedValue(JSON.stringify(existing));

      await expect(svc.createKey('m-1', 'Extra', ['payments:read']))
        .rejects.toThrow('Máximo 5 API keys');
    });

    it('rejects empty name', async () => {
      await expect(svc.createKey('m-1', '', ['payments:read']))
        .rejects.toThrow('Nombre debe tener entre 1 y 50 caracteres');
    });

    it('rejects name over 50 chars', async () => {
      await expect(svc.createKey('m-1', 'x'.repeat(51), ['payments:read']))
        .rejects.toThrow('Nombre debe tener entre 1 y 50 caracteres');
    });

    it('rejects empty permissions', async () => {
      await expect(svc.createKey('m-1', 'Test', []))
        .rejects.toThrow('Debe asignar al menos un permiso');
    });

    it('appends to existing keys', async () => {
      const existing: ApiKey[] = [{
        id: 'old', name: 'Old', keyPrefix: 'wp_live_xxxx',
        keyHash: 'oldhash', merchantId: 'm-1', permissions: ['payments:read'],
        createdAt: '2026-01-01', lastUsedAt: null, active: true,
      }];
      mockRedisGet.mockResolvedValue(JSON.stringify(existing));

      await svc.createKey('m-1', 'New', ['links:write']);
      const stored = JSON.parse(mockRedisSet.mock.calls[0][1]) as ApiKey[];
      expect(stored).toHaveLength(2);
      expect(stored[1].name).toBe('New');
    });

    it('does not throw on Redis save error', async () => {
      mockRedisSet.mockRejectedValue(new Error('Redis down'));
      const result = await svc.createKey('m-1', 'Test', ['payments:read']);
      expect(result.key).toBeDefined();
    });
  });

  // ─── getKeys ───────────────────────────────────────────

  describe('getKeys', () => {
    it('returns empty array when none stored', async () => {
      const keys = await svc.getKeys('m-1');
      expect(keys).toEqual([]);
    });

    it('returns stored keys', async () => {
      const stored: ApiKey[] = [{
        id: 'k1', name: 'Prod', keyPrefix: 'wp_live_xxxx',
        keyHash: 'hash1', merchantId: 'm-1', permissions: ['payments:read'],
        createdAt: '2026-01-01', lastUsedAt: null, active: true,
      }];
      mockRedisGet.mockResolvedValue(JSON.stringify(stored));

      const keys = await svc.getKeys('m-1');
      expect(keys).toHaveLength(1);
      expect(keys[0].name).toBe('Prod');
    });

    it('returns empty on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const keys = await svc.getKeys('m-1');
      expect(keys).toEqual([]);
    });
  });

  // ─── revokeKey ─────────────────────────────────────────

  describe('revokeKey', () => {
    it('deactivates a key and removes lookup', async () => {
      const keys: ApiKey[] = [{
        id: 'k1', name: 'Prod', keyPrefix: 'wp_live_xxxx',
        keyHash: 'abc123hash', merchantId: 'm-1', permissions: ['payments:read'],
        createdAt: '2026-01-01', lastUsedAt: null, active: true,
      }];
      mockRedisGet.mockResolvedValue(JSON.stringify(keys));

      const result = await svc.revokeKey('m-1', 'k1');
      expect(result).toBe(true);

      const stored = JSON.parse(mockRedisSet.mock.calls[0][1]) as ApiKey[];
      expect(stored[0].active).toBe(false);
      expect(mockRedisDel).toHaveBeenCalledWith('apikeys:lookup:abc123hash');
    });

    it('returns false for unknown key', async () => {
      mockRedisGet.mockResolvedValue(JSON.stringify([]));
      const result = await svc.revokeKey('m-1', 'nonexistent');
      expect(result).toBe(false);
    });

    it('does not throw on Redis error', async () => {
      const keys: ApiKey[] = [{
        id: 'k1', name: 'Prod', keyPrefix: 'wp_live_xxxx',
        keyHash: 'hash1', merchantId: 'm-1', permissions: ['payments:read'],
        createdAt: '2026-01-01', lastUsedAt: null, active: true,
      }];
      mockRedisGet.mockResolvedValue(JSON.stringify(keys));
      mockRedisSet.mockRejectedValue(new Error('Redis down'));

      const result = await svc.revokeKey('m-1', 'k1');
      expect(result).toBe(true);
    });
  });

  // ─── validateKey ───────────────────────────────────────

  describe('validateKey', () => {
    it('validates a correct key and updates lastUsedAt', async () => {
      const rawKey = 'wp_live_aabbccdd11223344aabbccdd11223344aabbccdd11223344';
      const crypto = require('crypto');
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

      const keys: ApiKey[] = [{
        id: 'k1', name: 'Prod', keyPrefix: 'wp_live_aabbccdd',
        keyHash, merchantId: 'm-1', permissions: ['payments:read'],
        createdAt: '2026-01-01', lastUsedAt: null, active: true,
      }];

      mockRedisGet
        .mockResolvedValueOnce(JSON.stringify({ merchantId: 'm-1', keyId: 'k1' })) // lookup
        .mockResolvedValueOnce(JSON.stringify(keys)); // getKeys

      const result = await svc.validateKey(rawKey);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('k1');
      expect(result!.merchantId).toBe('m-1');
    });

    it('returns null for unknown key', async () => {
      const result = await svc.validateKey('wp_live_unknown');
      expect(result).toBeNull();
    });

    it('returns null for revoked key', async () => {
      const rawKey = 'wp_live_testkey123456';
      const crypto = require('crypto');
      const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');

      const keys: ApiKey[] = [{
        id: 'k1', name: 'Prod', keyPrefix: 'wp_live_test',
        keyHash, merchantId: 'm-1', permissions: ['payments:read'],
        createdAt: '2026-01-01', lastUsedAt: null, active: false, // revoked
      }];

      mockRedisGet
        .mockResolvedValueOnce(JSON.stringify({ merchantId: 'm-1', keyId: 'k1' }))
        .mockResolvedValueOnce(JSON.stringify(keys));

      const result = await svc.validateKey(rawKey);
      expect(result).toBeNull();
    });

    it('returns null on Redis error', async () => {
      mockRedisGet.mockRejectedValue(new Error('Redis down'));
      const result = await svc.validateKey('wp_live_anything');
      expect(result).toBeNull();
    });
  });

  // ─── hasPermission ─────────────────────────────────────

  describe('hasPermission', () => {
    const key: ApiKey = {
      id: 'k1', name: 'Test', keyPrefix: 'wp_live_xxxx',
      keyHash: 'hash', merchantId: 'm-1',
      permissions: ['payments:read', 'links:write'],
      createdAt: '2026-01-01', lastUsedAt: null, active: true,
    };

    it('returns true for granted permission', () => {
      expect(svc.hasPermission(key, 'payments:read')).toBe(true);
      expect(svc.hasPermission(key, 'links:write')).toBe(true);
    });

    it('returns false for missing permission', () => {
      expect(svc.hasPermission(key, 'webhooks:manage')).toBe(false);
      expect(svc.hasPermission(key, 'transactions:read')).toBe(false);
    });
  });
});
