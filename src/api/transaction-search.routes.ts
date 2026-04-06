import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/jwt.middleware';
import { asyncHandler } from '../utils/async-handler';
import { transactionSearch } from '../services/transaction-search.service';

const router = Router();

// ─── GET /transactions/search ──────────────────────────
// Advanced transaction search with filters

router.get(
  '/transactions/search',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const result = await transactionSearch.search({
      userId: req.user!.userId,
      status: req.query.status as 'COMPLETED' | 'PENDING' | 'FAILED' | 'REFUNDED' | undefined,
      minAmount: req.query.minAmount ? Number(req.query.minAmount) : undefined,
      maxAmount: req.query.maxAmount ? Number(req.query.maxAmount) : undefined,
      startDate: req.query.startDate as string | undefined,
      endDate: req.query.endDate as string | undefined,
      counterpartyId: req.query.counterpartyId as string | undefined,
      reference: req.query.reference as string | undefined,
      paymentMethod: req.query.paymentMethod as string | undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : 20,
    });

    return res.json(result);
  }),
);

export default router;
