import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/jwt.middleware';
import { asyncHandler } from '../utils/async-handler';
import { env } from '../config/environment';
import { spendingLimits } from '../services/spending-limits.service';

const router = Router();

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_API_KEY) { res.status(503).json({ error: 'Admin API not configured.' }); return; }
  const key = req.headers['x-admin-key'] as string | undefined;
  if (!key || key !== env.ADMIN_API_KEY) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  next();
}

// ─── GET /spending-limits ───────────────────────────────

router.get(
  '/spending-limits',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const limits = await spendingLimits.getLimits(req.user!.userId);
    return res.json({ limits });
  }),
);

// ─── POST /spending-limits ──────────────────────────────

const limitsSchema = z.object({
  dailyLimit: z.number().int().min(0).optional(),
  weeklyLimit: z.number().int().min(0).optional(),
  alertThreshold: z.number().int().min(0).max(100).optional(),
});

router.post(
  '/spending-limits',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const parsed = limitsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.', details: parsed.error.flatten() });
    }

    try {
      const limits = await spendingLimits.setLimits(req.user!.userId, parsed.data);
      return res.json({ limits });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }),
);

// ─── GET /spending-limits/status ────────────────────────

router.get(
  '/spending-limits/status',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const status = await spendingLimits.getStatus(req.user!.userId);
    return res.json({ status });
  }),
);

// ─── POST /admin/spending-limits/:userId ────────────────

router.post(
  '/admin/spending-limits/:userId',
  requireAdminKey,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const parsed = limitsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.' });
    }

    try {
      const limits = await spendingLimits.setLimits(req.params.userId, parsed.data);
      return res.json({ userId: req.params.userId, limits });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }),
);

export default router;
