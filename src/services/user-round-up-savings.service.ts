import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-round-up-savings');
const PREFIX = 'user:round-up:';
const TTL = 365 * 24 * 60 * 60;

export type RoundUpMode = 'NEAREST_100' | 'NEAREST_500' | 'NEAREST_1000';

export interface RoundUpConfig {
  userId: string;
  enabled: boolean;
  mode: RoundUpMode;
  targetAccountId: string;
  totalSaved: number;
  transactionCount: number;
  updatedAt: string;
}

export class UserRoundUpSavingsService {
  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  async getConfig(userId: string): Promise<RoundUpConfig> {
    const raw = await getRedis().get(this.key(userId));
    if (raw) return JSON.parse(raw);
    return {
      userId,
      enabled: false,
      mode: 'NEAREST_100',
      targetAccountId: '',
      totalSaved: 0,
      transactionCount: 0,
      updatedAt: new Date().toISOString(),
    };
  }

  async enable(userId: string, mode: RoundUpMode, targetAccountId: string): Promise<RoundUpConfig> {
    if (!targetAccountId) throw new Error('Cuenta destino requerida');
    const current = await this.getConfig(userId);
    const updated: RoundUpConfig = {
      ...current,
      enabled: true,
      mode,
      targetAccountId,
      updatedAt: new Date().toISOString(),
    };
    await getRedis().set(this.key(userId), JSON.stringify(updated), { EX: TTL });
    log.info('round up enabled', { userId, mode });
    return updated;
  }

  async disable(userId: string): Promise<RoundUpConfig> {
    const current = await this.getConfig(userId);
    current.enabled = false;
    current.updatedAt = new Date().toISOString();
    await getRedis().set(this.key(userId), JSON.stringify(current), { EX: TTL });
    return current;
  }

  computeRoundUp(amount: number, mode: RoundUpMode): number {
    const step = mode === 'NEAREST_100' ? 100 : mode === 'NEAREST_500' ? 500 : 1000;
    const remainder = amount % step;
    return remainder === 0 ? 0 : step - remainder;
  }

  async recordTransaction(userId: string, amount: number): Promise<{ roundUp: number; totalSaved: number } | null> {
    if (amount <= 0) throw new Error('Monto debe ser positivo');
    const config = await this.getConfig(userId);
    if (!config.enabled) return null;
    const roundUp = this.computeRoundUp(amount, config.mode);
    if (roundUp === 0) return { roundUp: 0, totalSaved: config.totalSaved };
    config.totalSaved += roundUp;
    config.transactionCount++;
    config.updatedAt = new Date().toISOString();
    await getRedis().set(this.key(userId), JSON.stringify(config), { EX: TTL });
    return { roundUp, totalSaved: config.totalSaved };
  }

  async reset(userId: string): Promise<RoundUpConfig> {
    const current = await this.getConfig(userId);
    current.totalSaved = 0;
    current.transactionCount = 0;
    current.updatedAt = new Date().toISOString();
    await getRedis().set(this.key(userId), JSON.stringify(current), { EX: TTL });
    return current;
  }

  formatSummary(c: RoundUpConfig): string {
    const modes: Record<RoundUpMode, string> = {
      NEAREST_100: 'al 100 mas cercano',
      NEAREST_500: 'al 500 mas cercano',
      NEAREST_1000: 'al 1000 mas cercano',
    };
    return [
      `Redondeo: ${c.enabled ? 'ON' : 'OFF'}`,
      `Modo: ${modes[c.mode]}`,
      `Total ahorrado: $${c.totalSaved.toLocaleString('es-CL')}`,
      `Transacciones: ${c.transactionCount}`,
    ].join('\n');
  }
}

export const userRoundUpSavings = new UserRoundUpSavingsService();
