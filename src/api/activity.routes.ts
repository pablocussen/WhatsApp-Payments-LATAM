import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../utils/async-handler';
import { env } from '../config/environment';
import { activity } from '../services/activity.service';

const router = Router();

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_API_KEY) { res.status(503).json({ error: 'Admin API not configured.' }); return; }
  const key = req.headers['x-admin-key'] as string | undefined;
  if (!key || key !== env.ADMIN_API_KEY) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  next();
}

// ─── GET /admin/activity/user/:userId ──────────────────

router.get(
  '/admin/activity/user/:userId',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const result = await activity.getActivity(req.params.userId);
    return res.json({ activity: result });
  }),
);

export default router;
