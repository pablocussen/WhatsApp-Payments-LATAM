import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-table-qr');
const PREFIX = 'merchant:table-qr:';
const TTL = 365 * 24 * 60 * 60;

export type TableStatus = 'FREE' | 'OCCUPIED' | 'WAITING_PAYMENT' | 'RESERVED';

export interface Table {
  id: string;
  merchantId: string;
  number: number;
  capacity: number;
  zone: string;
  status: TableStatus;
  qrUrl: string;
  currentBillAmount: number;
  openedAt?: string;
  closedAt?: string;
  totalTransactions: number;
  totalRevenue: number;
}

export class MerchantTableQRService {
  private key(merchantId: string): string {
    return `${PREFIX}${merchantId}`;
  }

  async list(merchantId: string): Promise<Table[]> {
    const raw = await getRedis().get(this.key(merchantId));
    return raw ? JSON.parse(raw) : [];
  }

  async create(input: {
    merchantId: string;
    number: number;
    capacity: number;
    zone: string;
  }): Promise<Table> {
    if (input.number < 1 || input.number > 999) throw new Error('Numero de mesa fuera de rango');
    if (input.capacity < 1 || input.capacity > 30) throw new Error('Capacidad entre 1 y 30');
    const list = await this.list(input.merchantId);
    if (list.length >= 200) throw new Error('Maximo 200 mesas por comercio');
    if (list.some(t => t.number === input.number)) {
      throw new Error(`Ya existe mesa numero ${input.number}`);
    }
    const table: Table = {
      id: `tbl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      merchantId: input.merchantId,
      number: input.number,
      capacity: input.capacity,
      zone: input.zone,
      status: 'FREE',
      qrUrl: `https://whatpay.cl/t/${input.merchantId}/${input.number}`,
      currentBillAmount: 0,
      totalTransactions: 0,
      totalRevenue: 0,
    };
    list.push(table);
    await getRedis().set(this.key(input.merchantId), JSON.stringify(list), { EX: TTL });
    log.info('table created', { merchantId: input.merchantId, number: input.number });
    return table;
  }

  async occupy(merchantId: string, number: number): Promise<Table | null> {
    const list = await this.list(merchantId);
    const table = list.find(t => t.number === number);
    if (!table) return null;
    if (table.status !== 'FREE') throw new Error(`Mesa ${number} no disponible`);
    table.status = 'OCCUPIED';
    table.openedAt = new Date().toISOString();
    table.currentBillAmount = 0;
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return table;
  }

  async addToBill(merchantId: string, number: number, amount: number): Promise<Table | null> {
    if (amount <= 0) throw new Error('Monto debe ser positivo');
    const list = await this.list(merchantId);
    const table = list.find(t => t.number === number);
    if (!table) return null;
    if (table.status !== 'OCCUPIED') throw new Error('Mesa no ocupada');
    table.currentBillAmount += amount;
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return table;
  }

  async requestPayment(merchantId: string, number: number): Promise<Table | null> {
    const list = await this.list(merchantId);
    const table = list.find(t => t.number === number);
    if (!table) return null;
    if (table.status !== 'OCCUPIED') throw new Error('Mesa no ocupada');
    table.status = 'WAITING_PAYMENT';
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return table;
  }

  async closeTable(merchantId: string, number: number): Promise<Table | null> {
    const list = await this.list(merchantId);
    const table = list.find(t => t.number === number);
    if (!table) return null;
    if (table.status === 'FREE') return table;
    table.totalTransactions++;
    table.totalRevenue += table.currentBillAmount;
    table.status = 'FREE';
    table.closedAt = new Date().toISOString();
    table.currentBillAmount = 0;
    table.openedAt = undefined;
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return table;
  }

  async getByStatus(merchantId: string, status: TableStatus): Promise<Table[]> {
    const list = await this.list(merchantId);
    return list.filter(t => t.status === status);
  }

  async getOccupancyRate(merchantId: string): Promise<number> {
    const list = await this.list(merchantId);
    if (list.length === 0) return 0;
    const occupied = list.filter(t => t.status !== 'FREE').length;
    return Math.round((occupied / list.length) * 100);
  }
}

export const merchantTableQR = new MerchantTableQRService();
