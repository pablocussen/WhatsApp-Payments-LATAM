import { createHash, randomBytes } from 'crypto';
import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('api-key');

// ─── Types ──────────────────────────────────────────────

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;       // first 8 chars for identification (wp_live_XXXX...)
  keyHash: string;          // SHA-256 of full key (never store raw)
  merchantId: string;
  permissions: ApiPermission[];
  createdAt: string;
  lastUsedAt: string | null;
  active: boolean;
}

export type ApiPermission =
  | 'payments:read'
  | 'payments:write'
  | 'links:read'
  | 'links:write'
  | 'transactions:read'
  | 'webhooks:manage';

export interface ApiKeyCreateResult {
  id: string;
  name: string;
  key: string;              // full key — shown ONLY at creation
  keyPrefix: string;
  permissions: ApiPermission[];
}

const KEYS_PREFIX = 'apikeys:merchant:';
const LOOKUP_PREFIX = 'apikeys:lookup:';
const KEYS_TTL = 365 * 24 * 60 * 60;
const MAX_KEYS_PER_MERCHANT = 5;

// ─── Service ────────────────────────────────────────────

export class ApiKeyService {
  /**
   * Create a new API key for a merchant.
   * Returns the full key ONLY at creation time.
   */
  async createKey(
    merchantId: string,
    name: string,
    permissions: ApiPermission[],
  ): Promise<ApiKeyCreateResult> {
    const existing = await this.getKeys(merchantId);
    if (existing.length >= MAX_KEYS_PER_MERCHANT) {
      throw new Error(`Máximo ${MAX_KEYS_PER_MERCHANT} API keys por merchant`);
    }

    if (!name || name.length > 50) {
      throw new Error('Nombre debe tener entre 1 y 50 caracteres');
    }

    if (permissions.length === 0) {
      throw new Error('Debe asignar al menos un permiso');
    }

    const rawKey = `wp_live_${randomBytes(24).toString('hex')}`;
    const keyPrefix = rawKey.slice(0, 16);
    const keyHash = createHash('sha256').update(rawKey).digest('hex');
    const id = randomBytes(8).toString('hex');

    const apiKey: ApiKey = {
      id,
      name,
      keyPrefix,
      keyHash,
      merchantId,
      permissions,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      active: true,
    };

    const keys = [...existing, apiKey];

    try {
      const redis = getRedis();
      await redis.set(`${KEYS_PREFIX}${merchantId}`, JSON.stringify(keys), { EX: KEYS_TTL });
      // Reverse lookup: hash → merchantId + keyId
      await redis.set(`${LOOKUP_PREFIX}${keyHash}`, JSON.stringify({ merchantId, keyId: id }), { EX: KEYS_TTL });
    } catch (err) {
      log.warn('Failed to save API key', { merchantId, error: (err as Error).message });
    }

    log.info('API key created', { merchantId, keyId: id, name, permissions });

    return { id, name, key: rawKey, keyPrefix, permissions };
  }

  /**
   * List all API keys for a merchant (without hashes).
   */
  async getKeys(merchantId: string): Promise<ApiKey[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${KEYS_PREFIX}${merchantId}`);
      if (!raw) return [];
      return JSON.parse(raw) as ApiKey[];
    } catch {
      return [];
    }
  }

  /**
   * Revoke (deactivate) an API key.
   */
  async revokeKey(merchantId: string, keyId: string): Promise<boolean> {
    const keys = await this.getKeys(merchantId);
    const key = keys.find((k) => k.id === keyId);
    if (!key) return false;

    key.active = false;

    try {
      const redis = getRedis();
      await redis.set(`${KEYS_PREFIX}${merchantId}`, JSON.stringify(keys), { EX: KEYS_TTL });
      // Remove lookup entry
      await redis.del(`${LOOKUP_PREFIX}${key.keyHash}`);
    } catch (err) {
      log.warn('Failed to revoke API key', { merchantId, keyId, error: (err as Error).message });
    }

    log.info('API key revoked', { merchantId, keyId });
    return true;
  }

  /**
   * Validate a raw API key and return its metadata.
   * Used in authentication middleware.
   */
  async validateKey(rawKey: string): Promise<ApiKey | null> {
    const keyHash = createHash('sha256').update(rawKey).digest('hex');

    try {
      const redis = getRedis();

      // Lookup merchantId by hash
      const lookupRaw = await redis.get(`${LOOKUP_PREFIX}${keyHash}`);
      if (!lookupRaw) return null;

      const { merchantId, keyId } = JSON.parse(lookupRaw) as { merchantId: string; keyId: string };
      const keys = await this.getKeys(merchantId);
      const key = keys.find((k) => k.id === keyId && k.active);

      if (!key) return null;

      // Update last used
      key.lastUsedAt = new Date().toISOString();
      await redis.set(`${KEYS_PREFIX}${merchantId}`, JSON.stringify(keys), { EX: KEYS_TTL });

      return key;
    } catch (err) {
      log.warn('API key validation failed', { error: (err as Error).message });
      return null;
    }
  }

  /**
   * Check if an API key has a specific permission.
   */
  hasPermission(key: ApiKey, permission: ApiPermission): boolean {
    return key.permissions.includes(permission);
  }
}

export const apiKeys = new ApiKeyService();
