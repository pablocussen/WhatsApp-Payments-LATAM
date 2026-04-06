import { prisma } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP, formatDateCL } from '../utils/format';

const log = createLogger('transaction-search');

export interface TransactionSearchFilters {
  userId: string;
  status?: 'COMPLETED' | 'PENDING' | 'FAILED' | 'REFUNDED';
  minAmount?: number;
  maxAmount?: number;
  startDate?: string;   // ISO date
  endDate?: string;     // ISO date
  counterpartyId?: string;
  reference?: string;
  paymentMethod?: string;
  page?: number;
  pageSize?: number;
}

export interface TransactionSearchResult {
  id: string;
  reference: string;
  type: 'sent' | 'received';
  amount: number;
  amountFormatted: string;
  fee: number;
  status: string;
  counterpartyName: string | null;
  description: string | null;
  paymentMethod: string;
  createdAt: string;
  dateFormatted: string;
}

export interface SearchResponse {
  transactions: TransactionSearchResult[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  filters: Record<string, unknown>;
}

export class TransactionSearchService {
  async search(filters: TransactionSearchFilters): Promise<SearchResponse> {
    const page = Math.max(1, filters.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    // Build WHERE conditions
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    // User is either sender or receiver
    conditions.push(`(t."senderId" = $${paramIdx} OR t."receiverId" = $${paramIdx})`);
    params.push(filters.userId);
    paramIdx++;

    if (filters.status) {
      conditions.push(`t."status" = $${paramIdx}`);
      params.push(filters.status);
      paramIdx++;
    }

    if (filters.minAmount != null) {
      conditions.push(`t."amount" >= $${paramIdx}`);
      params.push(filters.minAmount);
      paramIdx++;
    }

    if (filters.maxAmount != null) {
      conditions.push(`t."amount" <= $${paramIdx}`);
      params.push(filters.maxAmount);
      paramIdx++;
    }

    if (filters.startDate) {
      conditions.push(`t."createdAt" >= $${paramIdx}::timestamptz`);
      params.push(filters.startDate);
      paramIdx++;
    }

    if (filters.endDate) {
      conditions.push(`t."createdAt" <= $${paramIdx}::timestamptz`);
      params.push(filters.endDate);
      paramIdx++;
    }

    if (filters.counterpartyId) {
      conditions.push(`(t."senderId" = $${paramIdx} OR t."receiverId" = $${paramIdx})`);
      params.push(filters.counterpartyId);
      paramIdx++;
    }

    if (filters.reference) {
      conditions.push(`t."reference" ILIKE $${paramIdx}`);
      params.push(`%${filters.reference}%`);
      paramIdx++;
    }

    if (filters.paymentMethod) {
      conditions.push(`t."paymentMethod" = $${paramIdx}`);
      params.push(filters.paymentMethod);
      paramIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    try {
      // Count total
      const countQuery = `SELECT COUNT(*)::int as total FROM "Transaction" t ${whereClause}`;
      const countResult = (await prisma.$queryRawUnsafe(countQuery, ...params)) as [{ total: number }];
      const total = countResult[0]?.total ?? 0;

      // Get page of results
      const dataQuery = `
        SELECT
          t."id", t."reference", t."senderId", t."receiverId",
          t."amount"::int as amount, t."fee"::int as fee,
          t."status", t."description", t."paymentMethod",
          t."createdAt"
        FROM "Transaction" t
        ${whereClause}
        ORDER BY t."createdAt" DESC
        LIMIT ${pageSize} OFFSET ${offset}
      `;
      const rows = (await prisma.$queryRawUnsafe(dataQuery, ...params)) as Array<{
        id: string; reference: string; senderId: string; receiverId: string;
        amount: number; fee: number; status: string; description: string | null;
        paymentMethod: string; createdAt: Date;
      }>;

      const transactions: TransactionSearchResult[] = rows.map((row) => ({
        id: row.id,
        reference: row.reference,
        type: row.senderId === filters.userId ? 'sent' : 'received',
        amount: row.amount,
        amountFormatted: formatCLP(row.amount),
        fee: row.fee,
        status: row.status,
        counterpartyName: null, // Would need a JOIN for names
        description: row.description,
        paymentMethod: row.paymentMethod,
        createdAt: new Date(row.createdAt).toISOString(),
        dateFormatted: formatDateCL(new Date(row.createdAt)),
      }));

      return {
        transactions,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
        filters: {
          status: filters.status ?? null,
          minAmount: filters.minAmount ?? null,
          maxAmount: filters.maxAmount ?? null,
          startDate: filters.startDate ?? null,
          endDate: filters.endDate ?? null,
        },
      };
    } catch (err) {
      log.error('Transaction search failed', { error: (err as Error).message, filters });
      return {
        transactions: [],
        total: 0,
        page,
        pageSize,
        totalPages: 0,
        filters: {},
      };
    }
  }
}

export const transactionSearch = new TransactionSearchService();
