import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('staff-permissions');
const SP_PREFIX = 'staffperm:';
const SP_TTL = 365 * 24 * 60 * 60;

export type Permission =
  | 'VIEW_TRANSACTIONS' | 'PROCESS_PAYMENTS' | 'ISSUE_REFUNDS'
  | 'MANAGE_PRODUCTS' | 'MANAGE_CUSTOMERS' | 'VIEW_REPORTS'
  | 'MANAGE_TEAM' | 'MANAGE_SETTINGS' | 'ACCESS_API' | 'VIEW_DASHBOARD';

export interface StaffPermissions {
  userId: string;
  merchantId: string;
  permissions: Permission[];
  grantedBy: string;
  grantedAt: string;
  expiresAt: string | null;
}

const ALL_PERMISSIONS: Permission[] = [
  'VIEW_TRANSACTIONS', 'PROCESS_PAYMENTS', 'ISSUE_REFUNDS',
  'MANAGE_PRODUCTS', 'MANAGE_CUSTOMERS', 'VIEW_REPORTS',
  'MANAGE_TEAM', 'MANAGE_SETTINGS', 'ACCESS_API', 'VIEW_DASHBOARD',
];

export class MerchantStaffPermissionsService {
  async grantPermissions(input: {
    userId: string; merchantId: string; permissions: Permission[];
    grantedBy: string; expiresInDays?: number;
  }): Promise<StaffPermissions> {
    for (const p of input.permissions) {
      if (!ALL_PERMISSIONS.includes(p)) throw new Error(`Permiso invalido: ${p}`);
    }

    const perms: StaffPermissions = {
      userId: input.userId, merchantId: input.merchantId,
      permissions: [...new Set(input.permissions)],
      grantedBy: input.grantedBy,
      grantedAt: new Date().toISOString(),
      expiresAt: input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000).toISOString()
        : null,
    };
    try {
      const redis = getRedis();
      await redis.set(`${SP_PREFIX}${input.merchantId}:${input.userId}`, JSON.stringify(perms), { EX: SP_TTL });
    } catch (err) { log.warn('Failed to grant permissions', { error: (err as Error).message }); }
    log.info('Permissions granted', { userId: input.userId, count: perms.permissions.length });
    return perms;
  }

  async getPermissions(merchantId: string, userId: string): Promise<StaffPermissions | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${SP_PREFIX}${merchantId}:${userId}`);
      return raw ? JSON.parse(raw) as StaffPermissions : null;
    } catch { return null; }
  }

  async hasPermission(merchantId: string, userId: string, permission: Permission): Promise<boolean> {
    const perms = await this.getPermissions(merchantId, userId);
    if (!perms) return false;
    if (perms.expiresAt && new Date() > new Date(perms.expiresAt)) return false;
    return perms.permissions.includes(permission);
  }

  async revokePermission(merchantId: string, userId: string, permission: Permission): Promise<boolean> {
    const perms = await this.getPermissions(merchantId, userId);
    if (!perms) return false;
    perms.permissions = perms.permissions.filter(p => p !== permission);
    try {
      const redis = getRedis();
      await redis.set(`${SP_PREFIX}${merchantId}:${userId}`, JSON.stringify(perms), { EX: SP_TTL });
    } catch { return false; }
    return true;
  }

  async revokeAll(merchantId: string, userId: string): Promise<boolean> {
    try {
      const redis = getRedis();
      await redis.set(`${SP_PREFIX}${merchantId}:${userId}`, JSON.stringify({ permissions: [] }), { EX: SP_TTL });
      return true;
    } catch { return false; }
  }

  getAllPermissions(): Permission[] {
    return [...ALL_PERMISSIONS];
  }
}

export const merchantStaffPermissions = new MerchantStaffPermissionsService();
