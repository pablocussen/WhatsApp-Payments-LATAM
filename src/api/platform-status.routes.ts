import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../utils/async-handler';
import { env } from '../config/environment';
import { platformStatus } from '../services/platform-status.service';

const router = Router();

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_API_KEY) { res.status(503).json({ error: 'Admin API not configured.' }); return; }
  const key = req.headers['x-admin-key'] as string | undefined;
  if (!key || key !== env.ADMIN_API_KEY) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  next();
}

// ─── GET /platform/info (PUBLIC) ────────────────────────
// Shows platform stats — no sensitive data

router.get(
  '/platform/info',
  asyncHandler(async (_req: Request, res: Response) => {
    const startedAt = new Date(Date.now() - process.uptime() * 1000);
    const info = platformStatus.getPlatformInfo(startedAt);
    return res.json({ platform: info });
  }),
);

// ─── GET /admin/platform/metrics ────────────────────────
// Request metrics for the current hour

router.get(
  '/admin/platform/metrics',
  requireAdminKey,
  asyncHandler(async (_req: Request, res: Response) => {
    const metrics = await platformStatus.getMetrics();
    return res.json({ metrics });
  }),
);

export default router;
