import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database';
import { env } from '../config/environment';
import { createLogger } from '../config/logger';
import { asyncHandler } from '../utils/async-handler';
import { audit } from '../services/audit.service';
import { WhatsAppService } from '../services/whatsapp.service';
import { activity } from '../services/activity.service';

const log = createLogger('admin-api');
const router = Router();

// ─── Admin API Key Middleware ────────────────────────────

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_API_KEY) {
    res.status(503).json({ error: 'Admin API not configured.' });
    return;
  }

  const key = req.headers['x-admin-key'] as string | undefined;
  if (!key || key !== env.ADMIN_API_KEY) {
    log.warn('Admin auth failed', { ip: req.ip });
    res.status(401).json({ error: 'Invalid admin key.' });
    return;
  }

  next();
}

router.use(requireAdminKey);

// ─── List Users ─────────────────────────────────────────

router.get(
  '/users',
  asyncHandler(async (req: Request, res: Response) => {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          waId: true,
          name: true,
          kycLevel: true,
          isActive: true,
          pinAttempts: true,
          lockedUntil: true,
          createdAt: true,
        },
      }),
      prisma.user.count(),
    ]);

    return res.json({ users, total, page, pageSize });
  }),
);

// ─── Get User Detail ────────────────────────────────────

router.get(
  '/users/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        waId: true,
        name: true,
        kycLevel: true,
        isActive: true,
        pinAttempts: true,
        lockedUntil: true,
        biometricEnabled: true,
        createdAt: true,
        updatedAt: true,
        wallet: { select: { balance: true, currency: true } },
      },
    });

    if (!user) return res.status(404).json({ error: 'User not found.' });

    // Convert BigInt wallet balance for JSON serialization
    const response = {
      ...user,
      wallet: user.wallet
        ? { ...user.wallet, balance: Number(user.wallet.balance) }
        : null,
    };
    return res.json(response);
  }),
);

// ─── Ban / Unban User ───────────────────────────────────

router.post(
  '/users/:id/ban',
  asyncHandler(async (req: Request, res: Response) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: false },
    });

    log.info('User banned', { userId: req.params.id, adminIp: req.ip });
    audit.log({ eventType: 'USER_BANNED', actorType: 'ADMIN', targetUserId: req.params.id, metadata: { adminIp: req.ip } });
    return res.json({ message: 'User banned.', userId: req.params.id });
  }),
);

router.post(
  '/users/:id/unban',
  asyncHandler(async (req: Request, res: Response) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    await prisma.user.update({
      where: { id: req.params.id },
      data: { isActive: true, pinAttempts: 0, lockedUntil: null },
    });

    log.info('User unbanned', { userId: req.params.id, adminIp: req.ip });
    audit.log({ eventType: 'USER_UNBANNED', actorType: 'ADMIN', targetUserId: req.params.id, metadata: { adminIp: req.ip } });
    return res.json({ message: 'User unbanned.', userId: req.params.id });
  }),
);

// ─── Update KYC Level ───────────────────────────────────

router.post(
  '/users/:id/kyc',
  asyncHandler(async (req: Request, res: Response) => {
    const schema = z.object({ level: z.enum(['BASIC', 'INTERMEDIATE', 'FULL']) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid KYC level.' });
    }

    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    await prisma.user.update({
      where: { id: req.params.id },
      data: { kycLevel: parsed.data.level },
    });

    log.info('KYC updated', { userId: req.params.id, level: parsed.data.level, adminIp: req.ip });
    return res.json({ message: `KYC set to ${parsed.data.level}.`, userId: req.params.id });
  }),
);

// ─── List Transactions ──────────────────────────────────

router.get(
  '/transactions',
  asyncHandler(async (req: Request, res: Response) => {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize as string) || 20));
    const status = req.query.status as string | undefined;

    const where = status ? { status: status as 'COMPLETED' | 'FAILED' | 'REVERSED' } : {};

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          reference: true,
          amount: true,
          fee: true,
          status: true,
          paymentMethod: true,
          createdAt: true,
          sender: { select: { waId: true, name: true } },
          receiver: { select: { waId: true, name: true } },
        },
      }),
      prisma.transaction.count({ where }),
    ]);

    return res.json({ transactions, total, page, pageSize });
  }),
);

// ─── Platform Stats ─────────────────────────────────────

router.get(
  '/stats',
  asyncHandler(async (_req: Request, res: Response) => {
    const [userCount, txCount, totalVolume, activeLinks] = await Promise.all([
      prisma.user.count({ where: { isActive: true } }),
      prisma.transaction.count({ where: { status: 'COMPLETED' } }),
      prisma.transaction.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      prisma.paymentLink.count({ where: { isActive: true } }),
    ]);

    return res.json({
      users: userCount,
      transactions: txCount,
      totalVolume: Number(totalVolume._sum.amount ?? 0),
      activePaymentLinks: activeLinks,
    });
  }),
);

// ─── Metrics ────────────────────────────────────────────

router.get(
  '/metrics',
  asyncHandler(async (_req: Request, res: Response) => {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      activeUsers30d,
      totalTxCompleted,
      volumeAndFees,
      volumeByMethod,
      recentSignups,
      recentTx,
    ] = await Promise.all([
      prisma.user.count({ where: { isActive: true } }),

      // Active users = distinct senders in last 30 days
      prisma.transaction.groupBy({
        by: ['senderId'],
        where: { status: 'COMPLETED', createdAt: { gte: thirtyDaysAgo } },
      }).then((rows: { senderId: string }[]) => rows.length),

      prisma.transaction.count({ where: { status: 'COMPLETED' } }),

      prisma.transaction.aggregate({
        where: { status: 'COMPLETED' },
        _sum: { amount: true, fee: true },
      }),

      // Volume by payment method
      prisma.transaction.groupBy({
        by: ['paymentMethod'],
        where: { status: 'COMPLETED' },
        _sum: { amount: true, fee: true },
        _count: true,
      }),

      // Daily signups (last 7 days)
      prisma.$queryRaw<{ day: string; count: string }[]>`
        SELECT DATE(created_at) as day, COUNT(*)::text as count
        FROM users WHERE created_at >= ${sevenDaysAgo}
        GROUP BY DATE(created_at) ORDER BY day DESC
      `,

      // Daily transactions (last 7 days)
      prisma.$queryRaw<{ day: string; count: string; volume: string }[]>`
        SELECT DATE(created_at) as day,
               COUNT(*)::text as count,
               COALESCE(SUM(amount), 0)::text as volume
        FROM transactions
        WHERE status = 'COMPLETED' AND created_at >= ${sevenDaysAgo}
        GROUP BY DATE(created_at) ORDER BY day DESC
      `,
    ]);

    return res.json({
      overview: {
        totalUsers,
        activeUsers30d,
        totalTransactions: totalTxCompleted,
        totalVolume: Number(volumeAndFees._sum.amount ?? 0),
        totalFees: Number(volumeAndFees._sum.fee ?? 0),
      },
      byMethod: volumeByMethod.map((row: { paymentMethod: string; _sum: { amount: bigint | null; fee: bigint | null }; _count: number }) => ({
        method: row.paymentMethod,
        count: row._count,
        volume: Number(row._sum.amount ?? 0),
        fees: Number(row._sum.fee ?? 0),
      })),
      daily: {
        signups: recentSignups.map((r: { day: string; count: string }) => ({
          day: String(r.day).slice(0, 10),
          count: Number(r.count),
        })),
        transactions: recentTx.map((r: { day: string; count: string; volume: string }) => ({
          day: String(r.day).slice(0, 10),
          count: Number(r.count),
          volume: Number(r.volume),
        })),
      },
    });
  }),
);

// ─── Transaction CSV Export ──────────────────────────────

router.get(
  '/transactions/export',
  asyncHandler(async (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    const from = req.query.from ? new Date(req.query.from as string) : undefined;
    const to = req.query.to ? new Date(req.query.to as string) : undefined;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: from } : {}),
        ...(to ? { lte: to } : {}),
      };
    }

    const transactions = await prisma.transaction.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10_000, // safety cap
      select: {
        reference: true,
        amount: true,
        fee: true,
        status: true,
        paymentMethod: true,
        description: true,
        createdAt: true,
        completedAt: true,
        sender: { select: { waId: true, name: true } },
        receiver: { select: { waId: true, name: true } },
      },
    });

    const header = 'reference,amount,fee,status,method,sender_phone,sender_name,receiver_phone,receiver_name,description,created_at,completed_at';
    const rows = transactions.map((tx: {
      reference: string;
      amount: number | bigint;
      fee: number | bigint | null;
      status: string;
      paymentMethod: string;
      description: string | null;
      createdAt: Date;
      completedAt: Date | null;
      sender: { waId: string; name: string | null };
      receiver: { waId: string; name: string | null };
    }) => {
      const esc = (s: string | null) => `"${(s ?? '').replace(/"/g, '""')}"`;
      return [
        tx.reference,
        Number(tx.amount),
        Number(tx.fee ?? 0),
        tx.status,
        tx.paymentMethod,
        tx.sender.waId,
        esc(tx.sender.name),
        tx.receiver.waId,
        esc(tx.receiver.name),
        esc(tx.description),
        tx.createdAt.toISOString(),
        tx.completedAt?.toISOString() ?? '',
      ].join(',');
    });

    const csv = [header, ...rows].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="transactions-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(csv);
  }),
);

// ─── Audit Log ──────────────────────────────────────────

router.get(
  '/audit',
  asyncHandler(async (req: Request, res: Response) => {
    const result = await audit.query({
      userId: req.query.userId as string | undefined,
      eventType: req.query.eventType as string | undefined,
      page: parseInt(req.query.page as string) || 1,
      pageSize: parseInt(req.query.pageSize as string) || 20,
    });

    return res.json(result);
  }),
);

// ─── Dead Letter Queue ──────────────────────────────────

router.get(
  '/dlq',
  asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const entries = await WhatsAppService.getDLQ(limit);
    return res.json({ entries, count: entries.length });
  }),
);

router.delete(
  '/dlq',
  asyncHandler(async (_req: Request, res: Response) => {
    const count = await WhatsAppService.clearDLQ();
    return res.json({ message: `Cleared ${count} DLQ entries.`, count });
  }),
);

// ─── User Activity ──────────────────────────────────────

router.get(
  '/users/:id/activity',
  asyncHandler(async (req: Request, res: Response) => {
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const userActivity = await activity.getActivity(req.params.id);
    return res.json(userActivity);
  }),
);

export default router;
