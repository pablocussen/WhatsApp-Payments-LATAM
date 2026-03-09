import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database';
import { env } from '../config/environment';
import { createLogger } from '../config/logger';
import { asyncHandler } from '../utils/async-handler';
import { audit } from '../services/audit.service';
import { WhatsAppService } from '../services/whatsapp.service';

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

export default router;
