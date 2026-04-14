import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import * as crypto from 'crypto';

const log = createLogger('user-wallet-pass');
const PREFIX = 'user:wallet-pass:';
const TTL = 365 * 24 * 60 * 60;

export type PassType = 'PAYMENT_CARD' | 'MEMBERSHIP' | 'COUPON' | 'BOARDING' | 'EVENT';
export type PassStatus = 'ACTIVE' | 'EXPIRED' | 'REVOKED';

export interface WalletPass {
  id: string;
  userId: string;
  type: PassType;
  title: string;
  subtitle: string;
  backgroundColor: string;
  barcode: string;
  barcodeFormat: 'QR' | 'PDF417' | 'CODE128';
  status: PassStatus;
  expiresAt?: string;
  metadata: Record<string, string>;
  downloadCount: number;
  createdAt: string;
}

export class UserWalletPassService {
  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  private generateBarcode(): string {
    return crypto.randomBytes(16).toString('hex').toUpperCase();
  }

  async list(userId: string): Promise<WalletPass[]> {
    const raw = await getRedis().get(this.key(userId));
    return raw ? JSON.parse(raw) : [];
  }

  async create(input: {
    userId: string;
    type: PassType;
    title: string;
    subtitle: string;
    backgroundColor?: string;
    barcodeFormat?: 'QR' | 'PDF417' | 'CODE128';
    expiresAt?: string;
    metadata?: Record<string, string>;
  }): Promise<WalletPass> {
    if (input.title.length > 50) throw new Error('Titulo excede 50 caracteres');
    if (input.subtitle.length > 100) throw new Error('Subtitulo excede 100 caracteres');
    const color = input.backgroundColor ?? '#06b6d4';
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('Color debe ser formato #RRGGBB');
    if (input.expiresAt && isNaN(new Date(input.expiresAt).getTime())) {
      throw new Error('Fecha expiracion invalida');
    }
    const list = await this.list(input.userId);
    if (list.filter(p => p.status === 'ACTIVE').length >= 50) {
      throw new Error('Maximo 50 passes activos');
    }
    const pass: WalletPass = {
      id: `pass_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: input.userId,
      type: input.type,
      title: input.title,
      subtitle: input.subtitle,
      backgroundColor: color,
      barcode: this.generateBarcode(),
      barcodeFormat: input.barcodeFormat ?? 'QR',
      status: 'ACTIVE',
      expiresAt: input.expiresAt,
      metadata: input.metadata ?? {},
      downloadCount: 0,
      createdAt: new Date().toISOString(),
    };
    list.push(pass);
    await getRedis().set(this.key(input.userId), JSON.stringify(list), { EX: TTL });
    log.info('wallet pass created', { id: pass.id, type: pass.type });
    return pass;
  }

  async recordDownload(userId: string, id: string): Promise<WalletPass | null> {
    const list = await this.list(userId);
    const pass = list.find(p => p.id === id);
    if (!pass) return null;
    if (pass.status !== 'ACTIVE') throw new Error('Pass no esta activo');
    pass.downloadCount++;
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return pass;
  }

  async revoke(userId: string, id: string): Promise<WalletPass | null> {
    const list = await this.list(userId);
    const pass = list.find(p => p.id === id);
    if (!pass) return null;
    if (pass.status === 'REVOKED') return pass;
    pass.status = 'REVOKED';
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return pass;
  }

  async expireOld(userId: string): Promise<number> {
    const list = await this.list(userId);
    const now = Date.now();
    let count = 0;
    for (const p of list) {
      if (p.status === 'ACTIVE' && p.expiresAt && new Date(p.expiresAt).getTime() < now) {
        p.status = 'EXPIRED';
        count++;
      }
    }
    if (count > 0) {
      await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    }
    return count;
  }

  async findByBarcode(userId: string, barcode: string): Promise<WalletPass | null> {
    const list = await this.list(userId);
    return list.find(p => p.barcode === barcode) ?? null;
  }

  async getByType(userId: string, type: PassType): Promise<WalletPass[]> {
    const list = await this.list(userId);
    return list.filter(p => p.type === type && p.status === 'ACTIVE');
  }

  async getStats(userId: string): Promise<{
    active: number;
    expired: number;
    revoked: number;
    totalDownloads: number;
    byType: Record<PassType, number>;
  }> {
    const list = await this.list(userId);
    const byType: Record<PassType, number> = {
      PAYMENT_CARD: 0,
      MEMBERSHIP: 0,
      COUPON: 0,
      BOARDING: 0,
      EVENT: 0,
    };
    for (const p of list) {
      if (p.status === 'ACTIVE') byType[p.type]++;
    }
    return {
      active: list.filter(p => p.status === 'ACTIVE').length,
      expired: list.filter(p => p.status === 'EXPIRED').length,
      revoked: list.filter(p => p.status === 'REVOKED').length,
      totalDownloads: list.reduce((s, p) => s + p.downloadCount, 0),
      byType,
    };
  }
}

export const userWalletPass = new UserWalletPassService();
