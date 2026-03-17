import { Router, Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/jwt.middleware';
import { asyncHandler } from '../utils/async-handler';
import { loyalty as loyaltySvc } from '../services/loyalty.service';
import { createLogger } from '../config/logger';

const router = Router();
const log = createLogger('loyalty-routes');

const redeemSchema = z.object({
  points: z.number().int().min(1),
  description: z.string().trim().max(100).optional(),
});

// ─── GET /loyalty/account ────────────────────────────────

router.get(
  '/loyalty/account',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const [account, tierInfo] = await Promise.all([
      loyaltySvc.getAccount(userId),
      loyaltySvc.getTierInfo(userId),
    ]);
    return res.json({ account, tierInfo });
  }),
);

// ─── GET /loyalty/history ────────────────────────────────

router.get(
  '/loyalty/history',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const history = await loyaltySvc.getHistory(userId, limit);
    return res.json({ history, count: history.length });
  }),
);

// ─── GET /loyalty/rewards ────────────────────────────────
// Public: list available rewards catalog

router.get(
  '/loyalty/rewards',
  asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
    const rewards = await loyaltySvc.getRewards();
    return res.json({ rewards });
  }),
);

// ─── POST /loyalty/redeem ────────────────────────────────

router.post(
  '/loyalty/redeem',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const parsed = redeemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.' });
    }
    const result = await loyaltySvc.redeemPoints(
      userId,
      parsed.data.points,
      parsed.data.description,
    );
    if (!result.success) {
      return res.status(409).json({ error: result.message });
    }
    log.info('Points redeemed', { userId, points: parsed.data.points });
    return res.json({ message: result.message, remaining: result.remaining });
  }),
);

export default router;
