import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-backup');
const BK_PREFIX = 'ubkp:';
const BK_TTL = 90 * 24 * 60 * 60;

export interface UserBackup {
  id: string;
  userId: string;
  type: 'AUTO' | 'MANUAL';
  sections: string[];
  sizeBytes: number;
  encryptionKey: string;
  status: 'CREATING' | 'READY' | 'EXPIRED';
  createdAt: string;
  expiresAt: string;
}

export class UserBackupService {
  async createBackup(userId: string, type: 'AUTO' | 'MANUAL' = 'MANUAL'): Promise<UserBackup> {
    const sections = ['profile', 'contacts', 'settings', 'budgets', 'goals', 'categories'];
    const backup: UserBackup = {
      id: `bkp_${Date.now().toString(36)}`, userId, type, sections,
      sizeBytes: 0, encryptionKey: this.generateKey(),
      status: 'CREATING', createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    };
    try { const redis = getRedis(); await redis.set(`${BK_PREFIX}${backup.id}`, JSON.stringify(backup), { EX: BK_TTL }); await redis.set(`${BK_PREFIX}latest:${userId}`, backup.id, { EX: BK_TTL }); }
    catch (err) { log.warn('Failed to create backup', { error: (err as Error).message }); }
    log.info('Backup created', { userId, backupId: backup.id, type });
    return backup;
  }

  async getBackup(backupId: string): Promise<UserBackup | null> {
    try { const redis = getRedis(); const raw = await redis.get(`${BK_PREFIX}${backupId}`); return raw ? JSON.parse(raw) as UserBackup : null; }
    catch { return null; }
  }

  async getLatestBackupId(userId: string): Promise<string | null> {
    try { const redis = getRedis(); return await redis.get(`${BK_PREFIX}latest:${userId}`); }
    catch { return null; }
  }

  async markReady(backupId: string, sizeBytes: number): Promise<boolean> {
    const backup = await this.getBackup(backupId);
    if (!backup) return false;
    backup.status = 'READY'; backup.sizeBytes = sizeBytes;
    try { const redis = getRedis(); await redis.set(`${BK_PREFIX}${backupId}`, JSON.stringify(backup), { EX: BK_TTL }); }
    catch { return false; }
    return true;
  }

  private generateKey(): string {
    return Array.from({ length: 32 }, () => Math.random().toString(36)[2]).join('');
  }
}

export const userBackup = new UserBackupService();
