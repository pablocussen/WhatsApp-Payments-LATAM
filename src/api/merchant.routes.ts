import { Router, Response } from 'express';
import { requireAuth, requireKycLevel, AuthenticatedRequest } from '../middleware/jwt.middleware';
import { MerchantService } from '../services/merchant.service';
import { asyncHandler } from '../utils/async-handler';

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
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(100, parseInt(req.query.pageSize as string) || 20);

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
    const startDate = req.query.start
      ? new Date(req.query.start as string)
      : new Date(new Date().getFullYear(), new Date().getMonth(), 1); // start of month
    const endDate = req.query.end ? new Date(req.query.end as string) : new Date();

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return res.status(400).json({ error: 'Fechas inválidas.' });
    }

    const report = await merchants.generateSettlementReport(req.user!.userId, startDate, endDate);

    return res.json(report);
  }),
);

export default router;
