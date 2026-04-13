import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-iou');
const PREFIX = 'user:iou:';
const TTL = 365 * 24 * 60 * 60;

export type IOUStatus = 'OPEN' | 'PARTIAL' | 'PAID' | 'CANCELLED';
export type IOUDirection = 'OWED_TO_ME' | 'I_OWE';

export interface IOU {
  id: string;
  userId: string;
  direction: IOUDirection;
  counterpartyId: string;
  counterpartyName: string;
  counterpartyPhone: string;
  totalAmount: number;
  paidAmount: number;
  description: string;
  dueDate?: string;
  status: IOUStatus;
  createdAt: string;
  updatedAt: string;
}

export class UserIOUService {
  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  async list(userId: string): Promise<IOU[]> {
    const raw = await getRedis().get(this.key(userId));
    return raw ? JSON.parse(raw) : [];
  }

  async create(input: {
    userId: string;
    direction: IOUDirection;
    counterpartyId: string;
    counterpartyName: string;
    counterpartyPhone: string;
    totalAmount: number;
    description: string;
    dueDate?: string;
  }): Promise<IOU> {
    if (input.totalAmount <= 0) throw new Error('Monto debe ser positivo');
    if (input.description.length > 200) throw new Error('Descripcion excede 200 caracteres');
    if (input.counterpartyName.length > 80) throw new Error('Nombre excede 80 caracteres');
    if (!/^\+?[0-9]{8,15}$/.test(input.counterpartyPhone)) throw new Error('Telefono invalido');
    if (input.dueDate && isNaN(new Date(input.dueDate).getTime())) {
      throw new Error('Fecha limite invalida');
    }
    const list = await this.list(input.userId);
    const open = list.filter(i => i.status === 'OPEN' || i.status === 'PARTIAL');
    if (open.length >= 100) throw new Error('Maximo 100 IOUs abiertos');
    const iou: IOU = {
      id: `iou_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: input.userId,
      direction: input.direction,
      counterpartyId: input.counterpartyId,
      counterpartyName: input.counterpartyName,
      counterpartyPhone: input.counterpartyPhone,
      totalAmount: input.totalAmount,
      paidAmount: 0,
      description: input.description,
      dueDate: input.dueDate,
      status: 'OPEN',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    list.push(iou);
    await getRedis().set(this.key(input.userId), JSON.stringify(list), { EX: TTL });
    log.info('iou created', { id: iou.id, direction: iou.direction });
    return iou;
  }

  async recordPayment(userId: string, id: string, amount: number): Promise<IOU | null> {
    if (amount <= 0) throw new Error('Pago debe ser positivo');
    const list = await this.list(userId);
    const iou = list.find(i => i.id === id);
    if (!iou) return null;
    if (iou.status === 'PAID' || iou.status === 'CANCELLED') {
      throw new Error('IOU no aceptando pagos');
    }
    const newPaid = iou.paidAmount + amount;
    if (newPaid > iou.totalAmount) throw new Error('Pago excede el total adeudado');
    iou.paidAmount = newPaid;
    iou.status = newPaid >= iou.totalAmount ? 'PAID' : 'PARTIAL';
    iou.updatedAt = new Date().toISOString();
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return iou;
  }

  async cancel(userId: string, id: string): Promise<IOU | null> {
    const list = await this.list(userId);
    const iou = list.find(i => i.id === id);
    if (!iou) return null;
    if (iou.status === 'PAID') throw new Error('No se puede cancelar IOU pagado');
    iou.status = 'CANCELLED';
    iou.updatedAt = new Date().toISOString();
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return iou;
  }

  async getBalance(userId: string): Promise<{ owedToMe: number; iOwe: number; net: number }> {
    const list = await this.list(userId);
    let owedToMe = 0;
    let iOwe = 0;
    for (const iou of list) {
      if (iou.status === 'PAID' || iou.status === 'CANCELLED') continue;
      const remaining = iou.totalAmount - iou.paidAmount;
      if (iou.direction === 'OWED_TO_ME') owedToMe += remaining;
      else iOwe += remaining;
    }
    return { owedToMe, iOwe, net: owedToMe - iOwe };
  }

  async getOverdue(userId: string): Promise<IOU[]> {
    const list = await this.list(userId);
    const now = Date.now();
    return list.filter(i =>
      (i.status === 'OPEN' || i.status === 'PARTIAL') &&
      i.dueDate !== undefined &&
      new Date(i.dueDate).getTime() < now
    );
  }

  async getByCounterparty(userId: string, counterpartyId: string): Promise<IOU[]> {
    const list = await this.list(userId);
    return list.filter(i => i.counterpartyId === counterpartyId);
  }
}

export const userIOU = new UserIOUService();
