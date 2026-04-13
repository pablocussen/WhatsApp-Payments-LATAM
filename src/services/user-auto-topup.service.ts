import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-auto-topup');
const PREFIX = 'user:auto-topup:';
const TTL = 365 * 24 * 60 * 60;

export type TriggerType = 'LOW_BALANCE' | 'SCHEDULED' | 'MANUAL';
export type TopupStatus = 'ACTIVE' | 'PAUSED' | 'DISABLED';

export interface AutoTopupConfig {
  userId: string;
  enabled: boolean;
  triggerType: TriggerType;
  minBalanceTrigger: number;
  topupAmount: number;
  sourceAccountId: string;
  maxPerMonth: number;
  usedThisMonth: number;
  status: TopupStatus;
  lastTopupAt?: string;
  createdAt: string;
  updatedAt: string;
}

export class UserAutoTopupService {
  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  async get(userId: string): Promise<AutoTopupConfig | null> {
    const raw = await getRedis().get(this.key(userId));
    return raw ? JSON.parse(raw) : null;
  }

  async configure(input: {
    userId: string;
    triggerType: TriggerType;
    minBalanceTrigger: number;
    topupAmount: number;
    sourceAccountId: string;
    maxPerMonth?: number;
  }): Promise<AutoTopupConfig> {
    if (input.topupAmount < 5000 || input.topupAmount > 500000) {
      throw new Error('Monto de recarga entre $5.000 y $500.000');
    }
    if (input.minBalanceTrigger < 0) throw new Error('Trigger no puede ser negativo');
    if (!input.sourceAccountId) throw new Error('Cuenta origen requerida');
    const maxPerMonth = input.maxPerMonth ?? 10;
    if (maxPerMonth < 1 || maxPerMonth > 30) {
      throw new Error('Max recargas mensuales entre 1 y 30');
    }
    const config: AutoTopupConfig = {
      userId: input.userId,
      enabled: true,
      triggerType: input.triggerType,
      minBalanceTrigger: input.minBalanceTrigger,
      topupAmount: input.topupAmount,
      sourceAccountId: input.sourceAccountId,
      maxPerMonth,
      usedThisMonth: 0,
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await getRedis().set(this.key(input.userId), JSON.stringify(config), { EX: TTL });
    log.info('auto topup configured', { userId: input.userId });
    return config;
  }

  async pause(userId: string): Promise<AutoTopupConfig | null> {
    const config = await this.get(userId);
    if (!config) return null;
    config.status = 'PAUSED';
    config.updatedAt = new Date().toISOString();
    await getRedis().set(this.key(userId), JSON.stringify(config), { EX: TTL });
    return config;
  }

  async resume(userId: string): Promise<AutoTopupConfig | null> {
    const config = await this.get(userId);
    if (!config) return null;
    config.status = 'ACTIVE';
    config.enabled = true;
    config.updatedAt = new Date().toISOString();
    await getRedis().set(this.key(userId), JSON.stringify(config), { EX: TTL });
    return config;
  }

  async disable(userId: string): Promise<AutoTopupConfig | null> {
    const config = await this.get(userId);
    if (!config) return null;
    config.status = 'DISABLED';
    config.enabled = false;
    config.updatedAt = new Date().toISOString();
    await getRedis().set(this.key(userId), JSON.stringify(config), { EX: TTL });
    return config;
  }

  async shouldTrigger(userId: string, currentBalance: number): Promise<boolean> {
    const config = await this.get(userId);
    if (!config || config.status !== 'ACTIVE') return false;
    if (config.triggerType !== 'LOW_BALANCE') return false;
    if (config.usedThisMonth >= config.maxPerMonth) return false;
    return currentBalance < config.minBalanceTrigger;
  }

  async recordTopup(userId: string): Promise<AutoTopupConfig | null> {
    const config = await this.get(userId);
    if (!config || config.status !== 'ACTIVE') return null;
    if (config.usedThisMonth >= config.maxPerMonth) {
      throw new Error('Limite mensual de recargas alcanzado');
    }
    config.usedThisMonth++;
    config.lastTopupAt = new Date().toISOString();
    config.updatedAt = new Date().toISOString();
    await getRedis().set(this.key(userId), JSON.stringify(config), { EX: TTL });
    log.info('topup recorded', { userId, used: config.usedThisMonth });
    return config;
  }

  async resetMonthlyUsage(userId: string): Promise<AutoTopupConfig | null> {
    const config = await this.get(userId);
    if (!config) return null;
    config.usedThisMonth = 0;
    config.updatedAt = new Date().toISOString();
    await getRedis().set(this.key(userId), JSON.stringify(config), { EX: TTL });
    return config;
  }
}

export const userAutoTopup = new UserAutoTopupService();
