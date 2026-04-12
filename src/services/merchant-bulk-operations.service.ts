import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('bulk-ops');
const BO_PREFIX = 'bulkop:';
const BO_TTL = 30 * 24 * 60 * 60;

export type BulkOpType = 'REFUND' | 'NOTIFY' | 'EXPORT' | 'TAG' | 'DELETE';
export type BulkOpStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'PARTIAL';

export interface BulkOperation {
  id: string;
  merchantId: string;
  type: BulkOpType;
  totalItems: number;
  processed: number;
  succeeded: number;
  failed: number;
  status: BulkOpStatus;
  errors: { itemId: string; error: string }[];
  startedAt: string;
  completedAt: string | null;
}

export class MerchantBulkOperationsService {
  async createOperation(merchantId: string, type: BulkOpType, totalItems: number): Promise<BulkOperation> {
    if (totalItems < 1 || totalItems > 10000) throw new Error('Items entre 1 y 10000.');
    const op: BulkOperation = {
      id: `bulk_${Date.now().toString(36)}`, merchantId, type,
      totalItems, processed: 0, succeeded: 0, failed: 0,
      status: 'QUEUED', errors: [],
      startedAt: new Date().toISOString(), completedAt: null,
    };
    try {
      const redis = getRedis();
      await redis.set(`${BO_PREFIX}${op.id}`, JSON.stringify(op), { EX: BO_TTL });
    } catch (err) { log.warn('Failed to create bulk op', { error: (err as Error).message }); }
    return op;
  }

  async updateProgress(opId: string, processed: number, succeeded: number, failed: number, errors: { itemId: string; error: string }[] = []): Promise<boolean> {
    const op = await this.getOperation(opId);
    if (!op) return false;
    op.processed = processed;
    op.succeeded = succeeded;
    op.failed = failed;
    op.errors = errors.slice(0, 100);
    op.status = 'PROCESSING';
    try {
      const redis = getRedis();
      await redis.set(`${BO_PREFIX}${opId}`, JSON.stringify(op), { EX: BO_TTL });
    } catch { return false; }
    return true;
  }

  async completeOperation(opId: string): Promise<BulkOperation | null> {
    const op = await this.getOperation(opId);
    if (!op) return null;
    op.completedAt = new Date().toISOString();
    op.status = op.failed === 0 ? 'COMPLETED' : op.succeeded === 0 ? 'FAILED' : 'PARTIAL';
    try {
      const redis = getRedis();
      await redis.set(`${BO_PREFIX}${opId}`, JSON.stringify(op), { EX: BO_TTL });
    } catch { return null; }
    log.info('Bulk operation completed', { opId, status: op.status });
    return op;
  }

  async getOperation(opId: string): Promise<BulkOperation | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${BO_PREFIX}${opId}`);
      return raw ? JSON.parse(raw) as BulkOperation : null;
    } catch { return null; }
  }

  getProgress(op: BulkOperation): number {
    return op.totalItems > 0 ? Math.round((op.processed / op.totalItems) * 100) : 0;
  }
}

export const merchantBulkOperations = new MerchantBulkOperationsService();
