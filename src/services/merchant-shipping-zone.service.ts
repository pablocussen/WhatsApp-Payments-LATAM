import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('shipping-zone');
const SZ_PREFIX = 'shipzone:';
const SZ_TTL = 365 * 24 * 60 * 60;

export interface ShippingZone {
  id: string;
  merchantId: string;
  name: string;
  comunas: string[];
  baseFee: number;
  freeShippingThreshold: number | null;
  estimatedDays: number;
  active: boolean;
  createdAt: string;
}

export class MerchantShippingZoneService {
  async createZone(input: {
    merchantId: string; name: string; comunas: string[];
    baseFee: number; freeShippingThreshold?: number; estimatedDays: number;
  }): Promise<ShippingZone> {
    if (!input.name) throw new Error('Nombre requerido.');
    if (input.comunas.length === 0) throw new Error('Al menos una comuna.');
    if (input.baseFee < 0) throw new Error('Tarifa no puede ser negativa.');
    if (input.estimatedDays < 0 || input.estimatedDays > 30) throw new Error('Dias estimados entre 0 y 30.');

    const zones = await this.getZones(input.merchantId);
    if (zones.length >= 20) throw new Error('Maximo 20 zonas.');

    const zone: ShippingZone = {
      id: 'zone_' + Date.now().toString(36),
      merchantId: input.merchantId, name: input.name,
      comunas: input.comunas.map(c => c.toLowerCase()),
      baseFee: input.baseFee,
      freeShippingThreshold: input.freeShippingThreshold ?? null,
      estimatedDays: input.estimatedDays,
      active: true,
      createdAt: new Date().toISOString(),
    };

    zones.push(zone);
    await this.save(input.merchantId, zones);
    return zone;
  }

  async getZones(merchantId: string): Promise<ShippingZone[]> {
    try { const redis = getRedis(); const raw = await redis.get(SZ_PREFIX + merchantId); return raw ? JSON.parse(raw) as ShippingZone[] : []; }
    catch { return []; }
  }

  async findZoneForComuna(merchantId: string, comuna: string): Promise<ShippingZone | null> {
    const zones = await this.getZones(merchantId);
    const lower = comuna.toLowerCase();
    return zones.find(z => z.active && z.comunas.includes(lower)) ?? null;
  }

  calculateShippingFee(zone: ShippingZone, orderTotal: number): number {
    if (zone.freeShippingThreshold !== null && orderTotal >= zone.freeShippingThreshold) return 0;
    return zone.baseFee;
  }

  formatZoneSummary(z: ShippingZone): string {
    const free = z.freeShippingThreshold ? ', envio gratis sobre ' + formatCLP(z.freeShippingThreshold) : '';
    return z.name + ': ' + z.comunas.length + ' comunas, ' + formatCLP(z.baseFee) + ' base, ' + z.estimatedDays + ' dias' + free;
  }

  private async save(merchantId: string, zones: ShippingZone[]): Promise<void> {
    try { const redis = getRedis(); await redis.set(SZ_PREFIX + merchantId, JSON.stringify(zones), { EX: SZ_TTL }); }
    catch (err) { log.warn('Failed to save zones', { error: (err as Error).message }); }
  }
}

export const merchantShippingZone = new MerchantShippingZoneService();
