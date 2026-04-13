import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-webhook-retry-queue');
const PREFIX = 'merchant:webhook-retry:';
const TTL = 7 * 24 * 60 * 60;

export type RetryStatus = 'PENDING' | 'RETRYING' | 'SUCCEEDED' | 'FAILED' | 'ABANDONED';

export interface WebhookRetryJob {
  id: string;
  merchantId: string;
  webhookUrl: string;
  eventType: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  status: RetryStatus;
  nextRetryAt: string;
  lastError?: string;
  createdAt: string;
  completedAt?: string;
}

export class MerchantWebhookRetryQueueService {
  private key(merchantId: string): string {
    return `${PREFIX}${merchantId}`;
  }

  async list(merchantId: string): Promise<WebhookRetryJob[]> {
    const raw = await getRedis().get(this.key(merchantId));
    return raw ? JSON.parse(raw) : [];
  }

  private computeNextRetry(attempts: number): Date {
    const backoffMinutes = Math.min(60, Math.pow(2, attempts));
    return new Date(Date.now() + backoffMinutes * 60000);
  }

  async enqueue(input: {
    merchantId: string;
    webhookUrl: string;
    eventType: string;
    payload: unknown;
    maxAttempts?: number;
  }): Promise<WebhookRetryJob> {
    if (!/^https:\/\//.test(input.webhookUrl)) throw new Error('URL debe ser HTTPS');
    if (input.eventType.length > 60) throw new Error('Tipo de evento excede 60 caracteres');
    const maxAttempts = input.maxAttempts ?? 5;
    if (maxAttempts < 1 || maxAttempts > 10) throw new Error('Max intentos entre 1 y 10');
    const list = await this.list(input.merchantId);
    const pending = list.filter(j => j.status === 'PENDING' || j.status === 'RETRYING');
    if (pending.length >= 1000) throw new Error('Cola de reintentos llena');
    const job: WebhookRetryJob = {
      id: `wrj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      merchantId: input.merchantId,
      webhookUrl: input.webhookUrl,
      eventType: input.eventType,
      payload: input.payload,
      attempts: 0,
      maxAttempts,
      status: 'PENDING',
      nextRetryAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    list.push(job);
    if (list.length > 2000) list.splice(0, list.length - 2000);
    await getRedis().set(this.key(input.merchantId), JSON.stringify(list), { EX: TTL });
    log.info('webhook job enqueued', { id: job.id });
    return job;
  }

  async markAttempt(merchantId: string, id: string, result: 'SUCCESS' | 'FAILURE', error?: string): Promise<WebhookRetryJob | null> {
    const list = await this.list(merchantId);
    const job = list.find(j => j.id === id);
    if (!job) return null;
    if (job.status === 'SUCCEEDED' || job.status === 'ABANDONED') {
      throw new Error('Job ya finalizado');
    }
    job.attempts++;
    if (result === 'SUCCESS') {
      job.status = 'SUCCEEDED';
      job.completedAt = new Date().toISOString();
    } else {
      job.lastError = error;
      if (job.attempts >= job.maxAttempts) {
        job.status = 'ABANDONED';
        job.completedAt = new Date().toISOString();
      } else {
        job.status = 'RETRYING';
        job.nextRetryAt = this.computeNextRetry(job.attempts).toISOString();
      }
    }
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return job;
  }

  async getDueJobs(merchantId: string): Promise<WebhookRetryJob[]> {
    const list = await this.list(merchantId);
    const now = Date.now();
    return list
      .filter(j =>
        (j.status === 'PENDING' || j.status === 'RETRYING') &&
        new Date(j.nextRetryAt).getTime() <= now
      )
      .sort((a, b) => new Date(a.nextRetryAt).getTime() - new Date(b.nextRetryAt).getTime());
  }

  async abandon(merchantId: string, id: string): Promise<WebhookRetryJob | null> {
    const list = await this.list(merchantId);
    const job = list.find(j => j.id === id);
    if (!job) return null;
    if (job.status === 'SUCCEEDED') throw new Error('No se puede abandonar job exitoso');
    job.status = 'ABANDONED';
    job.completedAt = new Date().toISOString();
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return job;
  }

  async getStats(merchantId: string): Promise<{
    pending: number;
    retrying: number;
    succeeded: number;
    abandoned: number;
    successRate: number;
  }> {
    const list = await this.list(merchantId);
    const pending = list.filter(j => j.status === 'PENDING').length;
    const retrying = list.filter(j => j.status === 'RETRYING').length;
    const succeeded = list.filter(j => j.status === 'SUCCEEDED').length;
    const abandoned = list.filter(j => j.status === 'ABANDONED').length;
    const finished = succeeded + abandoned;
    return {
      pending,
      retrying,
      succeeded,
      abandoned,
      successRate: finished > 0 ? Math.round((succeeded / finished) * 100) : 0,
    };
  }

  async cleanupOld(merchantId: string, olderThanHours: number): Promise<number> {
    const list = await this.list(merchantId);
    const cutoff = Date.now() - olderThanHours * 3600000;
    const before = list.length;
    const kept = list.filter(j => {
      if (j.status !== 'SUCCEEDED' && j.status !== 'ABANDONED') return true;
      if (!j.completedAt) return true;
      return new Date(j.completedAt).getTime() > cutoff;
    });
    if (kept.length < before) {
      await getRedis().set(this.key(merchantId), JSON.stringify(kept), { EX: TTL });
    }
    return before - kept.length;
  }
}

export const merchantWebhookRetryQueue = new MerchantWebhookRetryQueueService();
