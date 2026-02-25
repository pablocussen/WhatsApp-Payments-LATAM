import { prisma } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('merchant-service');

// ─── Types ──────────────────────────────────────────────

export interface MerchantDashboard {
  totalSales: string;
  totalSalesRaw: number;
  transactionCount: number;
  averageTicket: string;
  todaySales: string;
  todayCount: number;
  pendingSettlement: string;
  activeLinks: number;
}

export interface SettlementSummary {
  date: string;
  grossAmount: number;
  totalFees: number;
  netAmount: number;
  transactionCount: number;
  status: 'pending' | 'processing' | 'settled';
}

// ─── Merchant Service ───────────────────────────────────

export class MerchantService {

  async getDashboard(merchantId: string): Promise<MerchantDashboard> {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [monthlyStats, todayStats, activeLinks] = await Promise.all([
      // Monthly stats
      prisma.transaction.aggregate({
        where: {
          receiverId: merchantId,
          status: 'COMPLETED',
          createdAt: { gte: startOfMonth },
        },
        _sum: { amount: true, fee: true },
        _count: true,
        _avg: { amount: true },
      }),
      // Today stats
      prisma.transaction.aggregate({
        where: {
          receiverId: merchantId,
          status: 'COMPLETED',
          createdAt: { gte: startOfDay },
        },
        _sum: { amount: true },
        _count: true,
      }),
      // Active payment links
      prisma.paymentLink.count({
        where: { merchantId, isActive: true },
      }),
    ]);

    const totalSales = Number(monthlyStats._sum.amount ?? 0);
    const totalFees = Number(monthlyStats._sum.fee ?? 0);
    const todaySales = Number(todayStats._sum.amount ?? 0);

    return {
      totalSales: formatCLP(totalSales),
      totalSalesRaw: totalSales,
      transactionCount: monthlyStats._count,
      averageTicket: formatCLP(Number(monthlyStats._avg.amount ?? 0)),
      todaySales: formatCLP(todaySales),
      todayCount: todayStats._count,
      pendingSettlement: formatCLP(totalSales - totalFees), // simplified
      activeLinks,
    };
  }

  async getTransactions(merchantId: string, page = 1, pageSize = 20) {
    const skip = (page - 1) * pageSize;

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where: { receiverId: merchantId, status: 'COMPLETED' },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
        select: {
          id: true,
          amount: true,
          fee: true,
          reference: true,
          description: true,
          paymentMethod: true,
          createdAt: true,
          sender: { select: { name: true, waId: true } },
        },
      }),
      prisma.transaction.count({
        where: { receiverId: merchantId, status: 'COMPLETED' },
      }),
    ]);

    return {
      transactions: transactions.map((tx: any) => ({
        id: tx.id,
        amount: formatCLP(Number(tx.amount)),
        amountRaw: Number(tx.amount),
        fee: formatCLP(Number(tx.fee)),
        net: formatCLP(Number(tx.amount) - Number(tx.fee)),
        reference: tx.reference,
        description: tx.description,
        paymentMethod: tx.paymentMethod,
        date: tx.createdAt,
        customerName: tx.sender.name || 'Anónimo',
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async generateSettlementReport(merchantId: string, startDate: Date, endDate: Date): Promise<SettlementSummary> {
    const stats = await prisma.transaction.aggregate({
      where: {
        receiverId: merchantId,
        status: 'COMPLETED',
        createdAt: { gte: startDate, lte: endDate },
      },
      _sum: { amount: true, fee: true },
      _count: true,
    });

    const gross = Number(stats._sum.amount ?? 0);
    const fees = Number(stats._sum.fee ?? 0);

    log.info('Settlement report generated', {
      merchantId,
      period: `${startDate.toISOString()} - ${endDate.toISOString()}`,
      gross,
      fees,
      count: stats._count,
    });

    return {
      date: endDate.toISOString().split('T')[0],
      grossAmount: gross,
      totalFees: fees,
      netAmount: gross - fees,
      transactionCount: stats._count,
      status: 'pending',
    };
  }
}
