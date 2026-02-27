import { Router, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireKycLevel, AuthenticatedRequest } from '../middleware/jwt.middleware';
import { MerchantService } from '../services/merchant.service';
import { asyncHandler } from '../utils/async-handler';

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const settlementSchema = z.object({
  start: z.string().datetime({ offset: true }).optional(),
  end: z.string().datetime({ offset: true }).optional(),
});

const router = Router();
const merchants = new MerchantService();

// ─── Dashboard ──────────────────────────────────────────

router.get(
  '/dashboard',
  requireAuth,
  requireKycLevel('INTERMEDIATE'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const dashboard = await merchants.getDashboard(req.user!.userId);
    return res.json(dashboard);
  }),
);

// ─── Transactions ───────────────────────────────────────

router.get(
  '/transactions',
  requireAuth,
  requireKycLevel('INTERMEDIATE'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const parsed = paginationSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Parámetros de paginación inválidos.' });
    }
    const { page, pageSize } = parsed.data;

    const result = await merchants.getTransactions(req.user!.userId, page, pageSize);
    return res.json(result);
  }),
);

// ─── Settlement Report ──────────────────────────────────

router.get(
  '/settlement',
  requireAuth,
  requireKycLevel('INTERMEDIATE'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const parsed = settlementSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Fechas inválidas. Usa formato ISO 8601.' });
    }

    const now = new Date();
    const startDate = parsed.data.start
      ? new Date(parsed.data.start)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const endDate = parsed.data.end ? new Date(parsed.data.end) : now;

    const report = await merchants.generateSettlementReport(req.user!.userId, startDate, endDate);

    return res.json(report);
  }),
);

export default router;
