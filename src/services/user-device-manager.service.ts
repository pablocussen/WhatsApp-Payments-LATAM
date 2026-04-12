import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('device-manager');
const DEV_PREFIX = 'udev:';
const DEV_TTL = 365 * 24 * 60 * 60;
const MAX_DEVICES = 5;

export interface UserDevice {
  id: string;
  userId: string;
  name: string;
  type: 'PHONE' | 'TABLET' | 'DESKTOP';
  os: string;
  browser: string;
  ipAddress: string;
  trusted: boolean;
  lastUsedAt: string;
  addedAt: string;
}

export class UserDeviceManagerService {
  async addDevice(input: { userId: string; name: string; type: 'PHONE' | 'TABLET' | 'DESKTOP'; os: string; browser: string; ipAddress: string }): Promise<UserDevice> {
    const devices = await this.getDevices(input.userId);
    if (devices.length >= MAX_DEVICES) {
      const oldest = devices.sort((a, b) => new Date(a.lastUsedAt).getTime() - new Date(b.lastUsedAt).getTime())[0];
      if (oldest) await this.removeDevice(input.userId, oldest.id);
    }
    const device: UserDevice = {
      id: `dev_${Date.now().toString(36)}`, userId: input.userId, name: input.name,
      type: input.type, os: input.os, browser: input.browser, ipAddress: input.ipAddress,
      trusted: false, lastUsedAt: new Date().toISOString(), addedAt: new Date().toISOString(),
    };
    const updated = [...(await this.getDevices(input.userId)), device];
    await this.save(input.userId, updated);
    log.info('Device added', { userId: input.userId, deviceId: device.id });
    return device;
  }

  async getDevices(userId: string): Promise<UserDevice[]> {
    try { const redis = getRedis(); const raw = await redis.get(`${DEV_PREFIX}${userId}`); return raw ? JSON.parse(raw) as UserDevice[] : []; } catch { return []; }
  }

  async trustDevice(userId: string, deviceId: string): Promise<boolean> {
    const devices = await this.getDevices(userId);
    const dev = devices.find(d => d.id === deviceId);
    if (!dev) return false;
    dev.trusted = true;
    await this.save(userId, devices);
    return true;
  }

  async removeDevice(userId: string, deviceId: string): Promise<boolean> {
    const devices = await this.getDevices(userId);
    const filtered = devices.filter(d => d.id !== deviceId);
    if (filtered.length === devices.length) return false;
    await this.save(userId, filtered);
    return true;
  }

  async removeAllDevices(userId: string): Promise<number> {
    const devices = await this.getDevices(userId);
    await this.save(userId, []);
    return devices.length;
  }

  async touchDevice(userId: string, deviceId: string): Promise<void> {
    const devices = await this.getDevices(userId);
    const dev = devices.find(d => d.id === deviceId);
    if (dev) { dev.lastUsedAt = new Date().toISOString(); await this.save(userId, devices); }
  }

  private async save(userId: string, devices: UserDevice[]): Promise<void> {
    try { const redis = getRedis(); await redis.set(`${DEV_PREFIX}${userId}`, JSON.stringify(devices), { EX: DEV_TTL }); }
    catch (err) { log.warn('Failed to save devices', { userId, error: (err as Error).message }); }
  }
}

export const userDeviceManager = new UserDeviceManagerService();
