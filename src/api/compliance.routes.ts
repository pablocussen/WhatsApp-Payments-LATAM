import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../utils/async-handler';
import { env } from '../config/environment';
import { complianceLog } from '../services/compliance-log.service';

const router = Router();

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_API_KEY) { res.status(503).json({ error: 'Admin API not configured.' }); return; }
  const key = req.headers['x-admin-key'] as string | undefined;
  if (!key || key !== env.ADMIN_API_KEY) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  next();
}

// ─── GET /admin/compliance ──────────────────────────────

router.get(
  '/admin/compliance',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const entries = await complianceLog.getGlobalLog(limit);
    return res.json({ entries, count: entries.length });
  }),
);

// ─── GET /admin/compliance/stats ────────────────────────

router.get(
  '/admin/compliance/stats',
  requireAdminKey,
  asyncHandler(async (_req: Request, res: Response) => {
    const stats = await complianceLog.getStats();
    return res.json({ stats });
  }),
);

// ─── GET /admin/compliance/user/:userId ─────────────────

router.get(
  '/admin/compliance/user/:userId',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const entries = await complianceLog.getUserLog(req.params.userId, limit);
    return res.json({ entries, count: entries.length });
  }),
);

// ─── POST /admin/compliance/:entryId/review ─────────────

router.post(
  '/admin/compliance/:entryId/review',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId requerido.' });

    const reviewedBy = 'admin';
    const success = await complianceLog.markReviewed(req.params.entryId, userId, reviewedBy);
    if (!success) return res.status(404).json({ error: 'Entrada no encontrada o ya revisada.' });
    return res.json({ message: 'Entrada marcada como revisada.' });
  }),
);

export default router;
