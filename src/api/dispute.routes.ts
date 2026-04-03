import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/jwt.middleware';
import { asyncHandler } from '../utils/async-handler';
import { rateLimitAction } from '../middleware/auth.middleware';
import { env } from '../config/environment';
import { disputes as disputeSvc } from '../services/dispute.service';
import { createLogger } from '../config/logger';

const router = Router();
const log = createLogger('dispute-routes');

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_API_KEY) { res.status(503).json({ error: 'Admin API not configured.' }); return; }
  const key = req.headers['x-admin-key'] as string | undefined;
  if (!key || key !== env.ADMIN_API_KEY) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  next();
}

// ─── Schemas ────────────────────────────────────────────

const openDisputeSchema = z.object({
  transactionRef: z.string().trim().min(1).max(100),
  reason: z.enum(['unauthorized', 'duplicate', 'amount_mismatch', 'service_not_received', 'other']),
  description: z.string().trim().min(1).max(500),
  merchantId: z.string().trim().max(100).optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(['under_review', 'resolved_favor_customer', 'resolved_favor_merchant', 'closed']),
  resolution: z.string().trim().max(500).optional(),
});

// ─── POST /disputes ─────────────────────────────────────
// Auth: open a new dispute

router.post(
  '/disputes',
  requireAuth,
  rateLimitAction('dispute:create'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const parsed = openDisputeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.', details: parsed.error.flatten() });
    }

    try {
      const dispute = await disputeSvc.openDispute({
        ...parsed.data,
        openedBy: userId,
      });
      log.info('Dispute opened', { userId, disputeId: dispute.id });
      return res.status(201).json({ dispute });
    } catch (err) {
      return res.status(409).json({ error: (err as Error).message });
    }
  }),
);

// ─── GET /disputes ──────────────────────────────────────
// Auth: list user's disputes

router.get(
  '/disputes',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const disputes = await disputeSvc.getUserDisputes(userId);
    return res.json({ disputes, count: disputes.length });
  }),
);

// ─── GET /disputes/:id ─────────────────────────────────
// Auth: get dispute detail

router.get(
  '/disputes/:id',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const dispute = await disputeSvc.getDispute(req.params.id);
    if (!dispute) {
      return res.status(404).json({ error: 'Disputa no encontrada.' });
    }
    // Only the dispute owner can see it (admin has separate endpoint)
    if (dispute.openedBy !== req.user!.userId) {
      return res.status(403).json({ error: 'No autorizado.' });
    }
    return res.json({ dispute });
  }),
);

// ─── POST /admin/disputes/:id/status ────────────────────
// Admin: update dispute status

router.post(
  '/admin/disputes/:id/status',
  requireAdminKey,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const parsed = updateStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.' });
    }

    const dispute = await disputeSvc.updateStatus(
      req.params.id,
      parsed.data.status,
      parsed.data.resolution,
    );
    if (!dispute) {
      return res.status(404).json({ error: 'Disputa no encontrada o ya cerrada.' });
    }

    log.info('Dispute status updated by admin', { disputeId: req.params.id, status: parsed.data.status });
    return res.json({ dispute });
  }),
);

export default router;