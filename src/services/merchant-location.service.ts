import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-location');

const LOC_PREFIX = 'mloc:';
const LOC_TTL = 365 * 24 * 60 * 60;

export interface MerchantLocation {
  merchantId: string;
  name: string;
  address: string;
  city: string;
  region: string;
  lat: number;
  lng: number;
  phone: string | null;
  categories: string[];
  acceptsQR: boolean;
  acceptsLink: boolean;
  rating: number; // 0-5
  reviewCount: number;
  active: boolean;
  updatedAt: string;
}

export class MerchantLocationService {
  async setLocation(input: {
    merchantId: string;
    name: string;
    address: string;
    city: string;
    region: string;
    lat: number;
    lng: number;
    phone?: string;
    categories?: string[];
  }): Promise<MerchantLocation> {
    if (input.lat < -56 || input.lat > -17) throw new Error('Latitud fuera de Chile.');
    if (input.lng < -76 || input.lng > -66) throw new Error('Longitud fuera de Chile.');
    if (!input.name) throw new Error('Nombre requerido.');
    if (!input.address) throw new Error('Dirección requerida.');

    const location: MerchantLocation = {
      merchantId: input.merchantId,
      name: input.name,
      address: input.address,
      city: input.city,
      region: input.region,
      lat: input.lat,
      lng: input.lng,
      phone: input.phone ?? null,
      categories: input.categories ?? [],
      acceptsQR: true,
      acceptsLink: true,
      rating: 0,
      reviewCount: 0,
      active: true,
      updatedAt: new Date().toISOString(),
    };

    try {
      const redis = getRedis();
      await redis.set(`${LOC_PREFIX}${input.merchantId}`, JSON.stringify(location), { EX: LOC_TTL });
    } catch (err) {
      log.warn('Failed to save location', { merchantId: input.merchantId, error: (err as Error).message });
    }

    log.info('Location set', { merchantId: input.merchantId, city: input.city });
    return location;
  }

  async getLocation(merchantId: string): Promise<MerchantLocation | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${LOC_PREFIX}${merchantId}`);
      return raw ? JSON.parse(raw) as MerchantLocation : null;
    } catch {
      return null;
    }
  }

  /**
   * Calculate distance between two points (Haversine formula).
   */
  calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // km
    const dLat = this.toRad(lat2 - lat1);
    const dLng = this.toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /**
   * Find nearby merchants from a list.
   */
  findNearby(locations: MerchantLocation[], lat: number, lng: number, radiusKm: number): (MerchantLocation & { distance: number })[] {
    return locations
      .filter(l => l.active)
      .map(l => ({ ...l, distance: this.calculateDistance(lat, lng, l.lat, l.lng) }))
      .filter(l => l.distance <= radiusKm)
      .sort((a, b) => a.distance - b.distance);
  }

  /**
   * Update rating.
   */
  async addRating(merchantId: string, newRating: number): Promise<boolean> {
    if (newRating < 1 || newRating > 5) throw new Error('Rating entre 1 y 5.');
    const location = await this.getLocation(merchantId);
    if (!location) return false;

    const total = location.rating * location.reviewCount + newRating;
    location.reviewCount++;
    location.rating = Math.round((total / location.reviewCount) * 10) / 10;

    try {
      const redis = getRedis();
      await redis.set(`${LOC_PREFIX}${merchantId}`, JSON.stringify(location), { EX: LOC_TTL });
    } catch {
      return false;
    }
    return true;
  }

  formatLocation(loc: MerchantLocation): string {
    const stars = '★'.repeat(Math.round(loc.rating)) + '☆'.repeat(5 - Math.round(loc.rating));
    return `${loc.name} — ${loc.address}, ${loc.city} — ${stars} (${loc.reviewCount})`;
  }

  private toRad(deg: number): number {
    return deg * Math.PI / 180;
  }
}

export const merchantLocation = new MerchantLocationService();
