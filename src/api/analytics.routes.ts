import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../utils/async-handler';
import { env } from '../config/environment';
import { analytics } from '../services/analytics.service';

const router = Router();

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_API_KEY) { res.status(503).json({ error: 'Admin API not configured.' }); return; }
  const key = req.headers['x-admin-key'] as string | undefined;
  if (!key || key !== env.ADMIN_API_KEY) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  next();
}

// ─── GET /admin/analytics/daily ────────────────────────

router.get(
  '/admin/analytics/daily',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) {
      return res.status(400).json({ error: 'startDate and endDate are required.' });
    }
    const stats = await analytics.getDailyStats(startDate as string, endDate as string);
    return res.json({ stats });
  }),
);

// ─── GET /admin/analytics/active-users ─────────────────

router.get(
  '/admin/analytics/active-users',
  requireAdminKey,
  asyncHandler(async (_req: Request, res: Response) => {
    const counts = await analytics.getActiveUserCounts();
    return res.json({ counts });
  }),
);

// ─── GET /admin/analytics/user/:userId/insights ────────

router.get(
  '/admin/analytics/user/:userId/insights',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    const insights = await analytics.getUserInsights(userId);
    return res.json({ insights });
  }),
);

export default router;
