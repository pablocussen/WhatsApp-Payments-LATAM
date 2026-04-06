import { prisma } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('audit');

// ─── Types ──────────────────────────────────────────────

export type EventType =
  | 'PAYMENT_COMPLETED'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_BLOCKED'
  | 'REFUND_COMPLETED'
  | 'REFUND_FAILED'
  | 'USER_CREATED'
  | 'PIN_CHANGED'
  | 'ACCOUNT_LOCKED'
  | 'KYC_UPGRADED'
  | 'PIN_FAILED'
  | 'USER_BANNED'
  | 'USER_UNBANNED'
  | 'ACCOUNT_DELETION_REQUESTED'
  | 'ACCOUNT_DELETION_CANCELLED'
  | 'ACCOUNT_DELETION_COMPLETED';

export type ActorType = 'USER' | 'SYSTEM' | 'ADMIN';

export interface AuditEntry {
  eventType: EventType;
  actorType: ActorType;
  actorId?: string | null;
  targetUserId?: string | null;
  amount?: number | null;
  metadata?: Record<string, unknown> | null;
  status?: string;
  errorMessage?: string | null;
  transactionId?: string | null;
}

// ─── Audit Service ──────────────────────────────────────

export class AuditService {
  /**
   * Log an audit event. Fire-and-forget — never blocks the calling operation.
   */
  log(entry: AuditEntry): void {
    prisma.auditEvent
      .create({
        data: {
          eventType: entry.eventType,
          actorType: entry.actorType,
          actorId: entry.actorId ?? null,
          targetUserId: entry.targetUserId ?? null,
          amount: entry.amount != null ? BigInt(entry.amount) : null,
          metadata: (entry.metadata ?? undefined) as never,
          status: entry.status ?? 'SUCCESS',
          errorMessage: entry.errorMessage ?? null,
          transactionId: entry.transactionId ?? null,
        },
      })
      .catch((err: Error) => {
        log.warn('Failed to write audit event', {
          eventType: entry.eventType,
          error: err.message,
        });
      });
  }

  /**
   * Query audit events with pagination and optional filters.
   */
  async query(opts: {
    userId?: string;
    eventType?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{ events: AuditQueryResult[]; total: number }> {
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));

    const where: Record<string, unknown> = {};
    if (opts.userId) where.targetUserId = opts.userId;
    if (opts.eventType) where.eventType = opts.eventType;

    const [events, total] = await Promise.all([
      prisma.auditEvent.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.auditEvent.count({ where }),
    ]);

    return {
      events: events.map((e: Record<string, unknown> & { amount?: bigint | null }) => ({
        id: e.id as string,
        eventType: e.eventType as string,
        actorType: e.actorType as string,
        actorId: (e.actorId as string) ?? null,
        targetUserId: (e.targetUserId as string) ?? null,
        amount: e.amount != null ? Number(e.amount) : null,
        metadata: e.metadata,
        status: e.status as string,
        errorMessage: (e.errorMessage as string) ?? null,
        transactionId: (e.transactionId as string) ?? null,
        createdAt: e.createdAt as Date,
      })),
      total,
    };
  }
}

export interface AuditQueryResult {
  id: string;
  eventType: string;
  actorType: string;
  actorId: string | null;
  targetUserId: string | null;
  amount: number | null;
  metadata: unknown;
  status: string;
  errorMessage: string | null;
  transactionId: string | null;
  createdAt: Date;
}

// Singleton
export const audit = new AuditService();
