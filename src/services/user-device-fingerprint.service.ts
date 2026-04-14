import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import * as crypto from 'crypto';

const log = createLogger('user-device-fingerprint');
const PREFIX = 'user:device-fp:';
const TTL = 180 * 24 * 60 * 60;

export type TrustLevel = 'UNKNOWN' | 'RECOGNIZED' | 'TRUSTED' | 'BLOCKED';

export interface DeviceFingerprint {
  id: string;
  userId: string;
  fingerprintHash: string;
  userAgent: string;
  platform: string;
  ipAddress: string;
  trustLevel: TrustLevel;
  firstSeenAt: string;
  lastSeenAt: string;
  sessionCount: number;
  lastLocation?: string;
  blockedReason?: string;
}

export class UserDeviceFingerprintService {
  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  private hashComponents(components: { userAgent: string; platform: string; screenResolution?: string; timezone?: string }): string {
    const combined = `${components.userAgent}|${components.platform}|${components.screenResolution ?? ''}|${components.timezone ?? ''}`;
    return crypto.createHash('sha256').update(combined).digest('hex').slice(0, 32);
  }

  async list(userId: string): Promise<DeviceFingerprint[]> {
    const raw = await getRedis().get(this.key(userId));
    return raw ? JSON.parse(raw) : [];
  }

  async registerOrUpdate(input: {
    userId: string;
    userAgent: string;
    platform: string;
    ipAddress: string;
    screenResolution?: string;
    timezone?: string;
    location?: string;
  }): Promise<DeviceFingerprint> {
    if (input.userAgent.length > 500) throw new Error('User agent excede 500 caracteres');
    if (!input.ipAddress) throw new Error('IP address requerida');
    const fingerprintHash = this.hashComponents(input);
    const list = await this.list(input.userId);
    const existing = list.find(d => d.fingerprintHash === fingerprintHash);
    const now = new Date().toISOString();
    if (existing) {
      if (existing.trustLevel === 'BLOCKED') {
        throw new Error('Dispositivo bloqueado');
      }
      existing.lastSeenAt = now;
      existing.sessionCount++;
      existing.ipAddress = input.ipAddress;
      if (input.location) existing.lastLocation = input.location;
      if (existing.trustLevel === 'UNKNOWN' && existing.sessionCount >= 3) {
        existing.trustLevel = 'RECOGNIZED';
      }
      await getRedis().set(this.key(input.userId), JSON.stringify(list), { EX: TTL });
      return existing;
    }
    if (list.length >= 20) {
      list.sort((a, b) => new Date(a.lastSeenAt).getTime() - new Date(b.lastSeenAt).getTime());
      list.shift();
    }
    const device: DeviceFingerprint = {
      id: `dev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: input.userId,
      fingerprintHash,
      userAgent: input.userAgent,
      platform: input.platform,
      ipAddress: input.ipAddress,
      trustLevel: 'UNKNOWN',
      firstSeenAt: now,
      lastSeenAt: now,
      sessionCount: 1,
      lastLocation: input.location,
    };
    list.push(device);
    await getRedis().set(this.key(input.userId), JSON.stringify(list), { EX: TTL });
    log.info('new device registered', { userId: input.userId });
    return device;
  }

  async trust(userId: string, id: string): Promise<DeviceFingerprint | null> {
    const list = await this.list(userId);
    const device = list.find(d => d.id === id);
    if (!device) return null;
    if (device.trustLevel === 'BLOCKED') throw new Error('No se puede confiar en dispositivo bloqueado');
    device.trustLevel = 'TRUSTED';
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return device;
  }

  async block(userId: string, id: string, reason: string): Promise<DeviceFingerprint | null> {
    const list = await this.list(userId);
    const device = list.find(d => d.id === id);
    if (!device) return null;
    device.trustLevel = 'BLOCKED';
    device.blockedReason = reason;
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    log.warn('device blocked', { userId, id, reason });
    return device;
  }

  async remove(userId: string, id: string): Promise<boolean> {
    const list = await this.list(userId);
    const idx = list.findIndex(d => d.id === id);
    if (idx === -1) return false;
    list.splice(idx, 1);
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return true;
  }

  async isNewDevice(userId: string, userAgent: string, platform: string, screenResolution?: string, timezone?: string): Promise<boolean> {
    const hash = this.hashComponents({ userAgent, platform, screenResolution, timezone });
    const list = await this.list(userId);
    return !list.some(d => d.fingerprintHash === hash);
  }

  async getTrustedCount(userId: string): Promise<number> {
    const list = await this.list(userId);
    return list.filter(d => d.trustLevel === 'TRUSTED').length;
  }

  async getRecentlyActive(userId: string, days: number): Promise<DeviceFingerprint[]> {
    const list = await this.list(userId);
    const cutoff = Date.now() - days * 86400000;
    return list
      .filter(d => new Date(d.lastSeenAt).getTime() > cutoff)
      .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
  }
}

export const userDeviceFingerprint = new UserDeviceFingerprintService();
