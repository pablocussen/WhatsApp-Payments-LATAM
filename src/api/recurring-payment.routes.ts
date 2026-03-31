import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/jwt.middleware';
import { asyncHandler } from '../utils/async-handler';
import { env } from '../config/environment';
import { recurringPayments } from '../services/recurring-payment.service';

const router = Router();

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_API_KEY) { res.status(503).json({ error: 'Admin API not configured.' }); return; }
  const key = req.headers['x-admin-key'] as string | undefined;
  if (!key || key !== env.ADMIN_API_KEY) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  next();
}

// ─── Schemas ────────────────────────────────────────────

const createPlanSchema = z.object({
  merchantId: z.string().trim().min(1),
  subscriberId: z.string().trim().min(1),
  amount: z.number().int().min(100),
  frequency: z.enum(['weekly', 'biweekly', 'monthly']),
  description: z.string().trim().min(1).max(100),
});

// ─── GET /subscriptions ────────────────────────────────

router.get(
  '/subscriptions',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const plans = await recurringPayments.getUserPlans(req.user!.userId);
    return res.json({ plans, count: plans.length });
  }),
);

// ─── GET /subscriptions/:id ────────────────────────────

router.get(
  '/subscriptions/:id',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const plan = await recurringPayments.getPlan(req.params.id);
    if (!plan) {
      return res.status(404).json({ error: 'Suscripción no encontrada.' });
    }
    return res.json({ plan });
  }),
);

// ─── POST /subscriptions/:id/pause ─────────────────────

router.post(
  '/subscriptions/:id/pause',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const plan = await recurringPayments.pausePlan(req.params.id, req.user!.userId);
      if (!plan) {
        return res.status(404).json({ error: 'Suscripción no encontrada.' });
      }
      return res.json({ plan });
    } catch (err) {
      return res.status(409).json({ error: (err as Error).message });
    }
  }),
);

// ─── POST /subscriptions/:id/resume ────────────────────

router.post(
  '/subscriptions/:id/resume',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const plan = await recurringPayments.resumePlan(req.params.id, req.user!.userId);
      if (!plan) {
        return res.status(404).json({ error: 'Suscripción no encontrada.' });
      }
      return res.json({ plan });
    } catch (err) {
      return res.status(409).json({ error: (err as Error).message });
    }
  }),
);

// ─── POST /subscriptions/:id/cancel ────────────────────

router.post(
  '/subscriptions/:id/cancel',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    try {
      const plan = await recurringPayments.cancelPlan(req.params.id, req.user!.userId);
      if (!plan) {
        return res.status(404).json({ error: 'Suscripción no encontrada.' });
      }
      return res.json({ plan });
    } catch (err) {
      return res.status(409).json({ error: (err as Error).message });
    }
  }),
);

// ─── POST /admin/subscriptions ─────────────────────────

router.post(
  '/admin/subscriptions',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = createPlanSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.', details: parsed.error.flatten() });
    }

    const plan = await recurringPayments.createPlan(parsed.data);
    return res.status(201).json({ plan });
  }),
);

export default router;
