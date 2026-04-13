import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-stamp-card');
const PREFIX = 'merchant:stamp-card:';
const TTL = 365 * 24 * 60 * 60;

export interface StampCardConfig {
  merchantId: string;
  name: string;
  description: string;
  stampsRequired: number;
  rewardDescription: string;
  active: boolean;
  createdAt: string;
}

export interface CustomerStampCard {
  customerId: string;
  merchantId: string;
  stamps: number;
  redemptions: number;
  lastStampAt?: string;
  readyToRedeem: boolean;
}

export class MerchantStampCardService {
  private configKey(merchantId: string): string {
    return `${PREFIX}config:${merchantId}`;
  }

  private customerKey(merchantId: string, customerId: string): string {
    return `${PREFIX}customer:${merchantId}:${customerId}`;
  }

  async createConfig(input: {
    merchantId: string;
    name: string;
    description: string;
    stampsRequired: number;
    rewardDescription: string;
  }): Promise<StampCardConfig> {
    if (input.stampsRequired < 3 || input.stampsRequired > 30) {
      throw new Error('Sellos requeridos debe ser entre 3 y 30');
    }
    if (input.name.length > 40) {
      throw new Error('Nombre no puede superar 40 caracteres');
    }
    const config: StampCardConfig = {
      merchantId: input.merchantId,
      name: input.name,
      description: input.description,
      stampsRequired: input.stampsRequired,
      rewardDescription: input.rewardDescription,
      active: true,
      createdAt: new Date().toISOString(),
    };
    await getRedis().set(this.configKey(input.merchantId), JSON.stringify(config), { EX: TTL });
    log.info('stamp card config created', { merchantId: input.merchantId });
    return config;
  }

  async getConfig(merchantId: string): Promise<StampCardConfig | null> {
    const raw = await getRedis().get(this.configKey(merchantId));
    return raw ? JSON.parse(raw) : null;
  }

  async getCustomerCard(merchantId: string, customerId: string): Promise<CustomerStampCard> {
    const raw = await getRedis().get(this.customerKey(merchantId, customerId));
    if (raw) return JSON.parse(raw);
    return {
      customerId,
      merchantId,
      stamps: 0,
      redemptions: 0,
      readyToRedeem: false,
    };
  }

  async addStamp(merchantId: string, customerId: string): Promise<CustomerStampCard> {
    const config = await this.getConfig(merchantId);
    if (!config || !config.active) {
      throw new Error('Programa de sellos no activo');
    }
    const card = await this.getCustomerCard(merchantId, customerId);
    card.stamps++;
    card.lastStampAt = new Date().toISOString();
    card.readyToRedeem = card.stamps >= config.stampsRequired;
    await getRedis().set(this.customerKey(merchantId, customerId), JSON.stringify(card), { EX: TTL });
    return card;
  }

  async redeem(merchantId: string, customerId: string): Promise<CustomerStampCard> {
    const config = await this.getConfig(merchantId);
    if (!config) throw new Error('Programa no encontrado');
    const card = await this.getCustomerCard(merchantId, customerId);
    if (card.stamps < config.stampsRequired) {
      throw new Error(`Faltan ${config.stampsRequired - card.stamps} sellos`);
    }
    card.stamps -= config.stampsRequired;
    card.redemptions++;
    card.readyToRedeem = card.stamps >= config.stampsRequired;
    await getRedis().set(this.customerKey(merchantId, customerId), JSON.stringify(card), { EX: TTL });
    log.info('stamp card redeemed', { merchantId, customerId });
    return card;
  }

  async deactivate(merchantId: string): Promise<boolean> {
    const config = await this.getConfig(merchantId);
    if (!config) return false;
    config.active = false;
    await getRedis().set(this.configKey(merchantId), JSON.stringify(config), { EX: TTL });
    return true;
  }

  formatProgress(card: CustomerStampCard, config: StampCardConfig): string {
    const filled = '●'.repeat(card.stamps);
    const empty = '○'.repeat(Math.max(0, config.stampsRequired - card.stamps));
    const status = card.readyToRedeem ? '¡LISTO PARA CANJEAR!' : `${config.stampsRequired - card.stamps} sellos restantes`;
    return `${config.name}\n${filled}${empty}\n${status}\nPremio: ${config.rewardDescription}`;
  }
}

export const merchantStampCard = new MerchantStampCardService();
