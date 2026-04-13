import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-qr-paylink');
const PREFIX = 'user:qr-paylink:';
const TTL = 90 * 24 * 60 * 60;

export type QRStatus = 'ACTIVE' | 'USED' | 'EXPIRED' | 'CANCELLED';

export interface QRPayLink {
  id: string;
  userId: string;
  amount?: number;
  description: string;
  maxUses: number;
  currentUses: number;
  expiresAt: string;
  status: QRStatus;
  qrUrl: string;
  createdAt: string;
  lastUsedAt?: string;
}

export class UserQRPayLinkService {
  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  async list(userId: string): Promise<QRPayLink[]> {
    const raw = await getRedis().get(this.key(userId));
    return raw ? JSON.parse(raw) : [];
  }

  async create(input: {
    userId: string;
    amount?: number;
    description: string;
    maxUses?: number;
    validMinutes?: number;
  }): Promise<QRPayLink> {
    if (input.amount !== undefined && input.amount <= 0) {
      throw new Error('Monto debe ser positivo');
    }
    if (input.description.length > 100) throw new Error('Descripcion excede 100 caracteres');
    const maxUses = input.maxUses ?? 1;
    if (maxUses < 1 || maxUses > 1000) throw new Error('Max usos entre 1 y 1000');
    const validMinutes = input.validMinutes ?? 60;
    if (validMinutes < 1 || validMinutes > 10080) throw new Error('Validez entre 1 min y 1 semana');
    const list = await this.list(input.userId);
    const active = list.filter(q => q.status === 'ACTIVE');
    if (active.length >= 20) throw new Error('Maximo 20 QR activos simultaneos');
    const id = `qr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const link: QRPayLink = {
      id,
      userId: input.userId,
      amount: input.amount,
      description: input.description,
      maxUses,
      currentUses: 0,
      expiresAt: new Date(Date.now() + validMinutes * 60000).toISOString(),
      status: 'ACTIVE',
      qrUrl: `https://whatpay.cl/pay/${id}`,
      createdAt: new Date().toISOString(),
    };
    list.push(link);
    await getRedis().set(this.key(input.userId), JSON.stringify(list), { EX: TTL });
    log.info('qr paylink created', { id });
    return link;
  }

  async redeem(userId: string, id: string): Promise<QRPayLink | null> {
    const list = await this.list(userId);
    const link = list.find(q => q.id === id);
    if (!link) return null;
    if (link.status !== 'ACTIVE') throw new Error(`QR ${link.status.toLowerCase()}`);
    if (new Date(link.expiresAt).getTime() < Date.now()) {
      link.status = 'EXPIRED';
      await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
      throw new Error('QR expirado');
    }
    link.currentUses++;
    link.lastUsedAt = new Date().toISOString();
    if (link.currentUses >= link.maxUses) {
      link.status = 'USED';
    }
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return link;
  }

  async cancel(userId: string, id: string): Promise<QRPayLink | null> {
    const list = await this.list(userId);
    const link = list.find(q => q.id === id);
    if (!link) return null;
    if (link.status !== 'ACTIVE') throw new Error('Solo se puede cancelar QR activo');
    link.status = 'CANCELLED';
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return link;
  }

  async expireOld(userId: string): Promise<number> {
    const list = await this.list(userId);
    const now = Date.now();
    let count = 0;
    for (const q of list) {
      if (q.status === 'ACTIVE' && new Date(q.expiresAt).getTime() < now) {
        q.status = 'EXPIRED';
        count++;
      }
    }
    if (count > 0) await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return count;
  }

  async getActive(userId: string): Promise<QRPayLink[]> {
    const list = await this.list(userId);
    return list.filter(q => q.status === 'ACTIVE');
  }
}

export const userQRPayLink = new UserQRPayLinkService();
