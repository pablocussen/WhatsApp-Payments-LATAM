import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-export-data');
const EXP_PREFIX = 'uexport:';
const EXP_TTL = 7 * 24 * 60 * 60;

export type ExportStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'EXPIRED';

export interface UserDataExport {
  id: string;
  userId: string;
  status: ExportStatus;
  sections: string[];
  format: 'JSON' | 'CSV';
  fileSize: number | null;
  downloadUrl: string | null;
  requestedAt: string;
  completedAt: string | null;
  expiresAt: string;
}

export class UserExportDataService {
  async requestExport(userId: string, sections: string[], format: 'JSON' | 'CSV' = 'JSON'): Promise<UserDataExport> {
    if (!sections.length) throw new Error('Selecciona al menos una seccion.');
    const validSections = ['profile', 'transactions', 'contacts', 'settings', 'activity', 'budgets', 'goals'];
    for (const s of sections) {
      if (!validSections.includes(s)) throw new Error(`Seccion invalida: ${s}`);
    }

    // Check cooldown (1 export per day)
    const existing = await this.getLatestExport(userId);
    if (existing && existing.status !== 'EXPIRED') {
      const hoursSince = (Date.now() - new Date(existing.requestedAt).getTime()) / (1000 * 60 * 60);
      if (hoursSince < 24) throw new Error('Solo puedes exportar una vez cada 24 horas.');
    }

    const exp: UserDataExport = {
      id: `uexp_${Date.now().toString(36)}`, userId, status: 'PENDING',
      sections, format, fileSize: null, downloadUrl: null,
      requestedAt: new Date().toISOString(), completedAt: null,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
    try { const redis = getRedis(); await redis.set(`${EXP_PREFIX}${exp.id}`, JSON.stringify(exp), { EX: EXP_TTL }); await redis.set(`${EXP_PREFIX}latest:${userId}`, JSON.stringify(exp), { EX: EXP_TTL }); }
    catch (err) { log.warn('Failed to save export request', { error: (err as Error).message }); }
    log.info('Data export requested', { userId, sections });
    return exp;
  }

  async getExport(exportId: string): Promise<UserDataExport | null> {
    try { const redis = getRedis(); const raw = await redis.get(`${EXP_PREFIX}${exportId}`); return raw ? JSON.parse(raw) as UserDataExport : null; }
    catch { return null; }
  }

  async getLatestExport(userId: string): Promise<UserDataExport | null> {
    try { const redis = getRedis(); const raw = await redis.get(`${EXP_PREFIX}latest:${userId}`); return raw ? JSON.parse(raw) as UserDataExport : null; }
    catch { return null; }
  }

  async markReady(exportId: string, fileSize: number, downloadUrl: string): Promise<boolean> {
    const exp = await this.getExport(exportId);
    if (!exp) return false;
    exp.status = 'READY'; exp.fileSize = fileSize; exp.downloadUrl = downloadUrl;
    exp.completedAt = new Date().toISOString();
    try { const redis = getRedis(); await redis.set(`${EXP_PREFIX}${exportId}`, JSON.stringify(exp), { EX: EXP_TTL }); }
    catch { return false; }
    return true;
  }

  getValidSections(): string[] {
    return ['profile', 'transactions', 'contacts', 'settings', 'activity', 'budgets', 'goals'];
  }
}

export const userExportData = new UserExportDataService();
