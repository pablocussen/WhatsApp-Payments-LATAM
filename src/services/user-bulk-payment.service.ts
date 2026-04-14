import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-bulk-payment');
const PREFIX = 'user:bulk-payment:';
const TTL = 90 * 24 * 60 * 60;

export type BulkStatus = 'DRAFT' | 'SCHEDULED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface BulkRecipient {
  phone: string;
  name: string;
  amount: number;
  note?: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  transactionId?: string;
  errorMessage?: string;
}

export interface BulkPaymentBatch {
  id: string;
  userId: string;
  name: string;
  recipients: BulkRecipient[];
  totalAmount: number;
  recipientCount: number;
  status: BulkStatus;
  scheduledAt?: string;
  startedAt?: string;
  completedAt?: string;
  successCount: number;
  failureCount: number;
  createdAt: string;
}

export class UserBulkPaymentService {
  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  async list(userId: string): Promise<BulkPaymentBatch[]> {
    const raw = await getRedis().get(this.key(userId));
    return raw ? JSON.parse(raw) : [];
  }

  async create(input: {
    userId: string;
    name: string;
    recipients: { phone: string; name: string; amount: number; note?: string }[];
  }): Promise<BulkPaymentBatch> {
    if (input.name.length > 60) throw new Error('Nombre excede 60 caracteres');
    if (input.recipients.length === 0) throw new Error('Se requiere al menos un destinatario');
    if (input.recipients.length > 500) throw new Error('Maximo 500 destinatarios por lote');
    const phoneRegex = /^\+?[0-9]{8,15}$/;
    for (const r of input.recipients) {
      if (!phoneRegex.test(r.phone)) throw new Error(`Telefono invalido: ${r.phone}`);
      if (r.amount <= 0) throw new Error(`Monto invalido para ${r.phone}`);
      if (r.name.length > 60) throw new Error(`Nombre excede 60 caracteres: ${r.phone}`);
    }
    const totalAmount = input.recipients.reduce((s, r) => s + r.amount, 0);
    if (totalAmount > 50000000) throw new Error('Total excede limite de $50.000.000');
    const list = await this.list(input.userId);
    const activeDraft = list.filter(b => b.status === 'DRAFT' || b.status === 'SCHEDULED').length;
    if (activeDraft >= 10) throw new Error('Maximo 10 lotes activos');
    const batch: BulkPaymentBatch = {
      id: `bulk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: input.userId,
      name: input.name,
      recipients: input.recipients.map(r => ({ ...r, status: 'PENDING' })),
      totalAmount,
      recipientCount: input.recipients.length,
      status: 'DRAFT',
      successCount: 0,
      failureCount: 0,
      createdAt: new Date().toISOString(),
    };
    list.push(batch);
    await getRedis().set(this.key(input.userId), JSON.stringify(list), { EX: TTL });
    log.info('bulk payment created', { id: batch.id, count: batch.recipientCount });
    return batch;
  }

  async schedule(userId: string, id: string, scheduledAt: string): Promise<BulkPaymentBatch | null> {
    if (isNaN(new Date(scheduledAt).getTime())) throw new Error('Fecha invalida');
    if (new Date(scheduledAt).getTime() < Date.now()) throw new Error('Fecha debe ser futura');
    const list = await this.list(userId);
    const batch = list.find(b => b.id === id);
    if (!batch) return null;
    if (batch.status !== 'DRAFT') throw new Error('Solo se puede programar lotes en borrador');
    batch.status = 'SCHEDULED';
    batch.scheduledAt = scheduledAt;
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return batch;
  }

  async startProcessing(userId: string, id: string): Promise<BulkPaymentBatch | null> {
    const list = await this.list(userId);
    const batch = list.find(b => b.id === id);
    if (!batch) return null;
    if (batch.status !== 'SCHEDULED' && batch.status !== 'DRAFT') {
      throw new Error('Lote no puede procesarse');
    }
    batch.status = 'PROCESSING';
    batch.startedAt = new Date().toISOString();
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return batch;
  }

  async recordRecipientResult(
    userId: string,
    id: string,
    phone: string,
    result: 'SENT' | 'FAILED',
    transactionId?: string,
    errorMessage?: string,
  ): Promise<BulkPaymentBatch | null> {
    const list = await this.list(userId);
    const batch = list.find(b => b.id === id);
    if (!batch) return null;
    if (batch.status !== 'PROCESSING') throw new Error('Lote no esta procesando');
    const recipient = batch.recipients.find(r => r.phone === phone && r.status === 'PENDING');
    if (!recipient) return batch;
    recipient.status = result;
    recipient.transactionId = transactionId;
    recipient.errorMessage = errorMessage;
    if (result === 'SENT') batch.successCount++;
    else batch.failureCount++;
    const allDone = batch.recipients.every(r => r.status !== 'PENDING');
    if (allDone) {
      batch.status = batch.failureCount === batch.recipientCount ? 'FAILED' : 'COMPLETED';
      batch.completedAt = new Date().toISOString();
    }
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return batch;
  }

  async cancel(userId: string, id: string): Promise<BulkPaymentBatch | null> {
    const list = await this.list(userId);
    const batch = list.find(b => b.id === id);
    if (!batch) return null;
    if (batch.status === 'COMPLETED' || batch.status === 'FAILED') {
      throw new Error('No se puede cancelar lote finalizado');
    }
    batch.status = 'CANCELLED';
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return batch;
  }

  async getProgress(userId: string, id: string): Promise<{ completed: number; total: number; percentage: number } | null> {
    const list = await this.list(userId);
    const batch = list.find(b => b.id === id);
    if (!batch) return null;
    const completed = batch.successCount + batch.failureCount;
    return {
      completed,
      total: batch.recipientCount,
      percentage: Math.round((completed / batch.recipientCount) * 100),
    };
  }

  async getDueForProcessing(userId: string): Promise<BulkPaymentBatch[]> {
    const list = await this.list(userId);
    const now = Date.now();
    return list.filter(b =>
      b.status === 'SCHEDULED' &&
      b.scheduledAt !== undefined &&
      new Date(b.scheduledAt).getTime() <= now
    );
  }
}

export const userBulkPayment = new UserBulkPaymentService();
