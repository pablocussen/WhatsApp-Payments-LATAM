import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/jwt.middleware';
import { asyncHandler } from '../utils/async-handler';
import { env } from '../config/environment';
import { merchantOnboarding as onboardSvc } from '../services/merchant-onboarding.service';
import { createLogger } from '../config/logger';

const router = Router();
const log = createLogger('merchant-onboarding-routes');

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_API_KEY) { res.status(503).json({ error: 'Admin API not configured.' }); return; }
  const key = req.headers['x-admin-key'] as string | undefined;
  if (!key || key !== env.ADMIN_API_KEY) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  next();
}

// ─── Schemas ────────────────────────────────────────────

const applySchema = z.object({
  businessName: z.string().trim().min(1).max(100),
  businessType: z.enum(['individual', 'company', 'nonprofit']),
  rut: z.string().trim().regex(/^\d{7,8}-[\dkK]$/, 'RUT inválido'),
  contactEmail: z.string().trim().email().max(254),
  contactPhone: z.string().trim().regex(/^\+?\d{8,15}$/, 'Teléfono inválido'),
  category: z.enum(['food', 'retail', 'services', 'technology', 'health', 'education', 'transport', 'entertainment', 'other']),
  description: z.string().trim().min(1).max(500),
});

const reviewSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  notes: z.string().trim().max(500).optional(),
});

// ─── POST /merchants/apply ──────────────────────────────
// Auth: submit merchant application

router.post(
  '/merchants/apply',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const parsed = applySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.', details: parsed.error.flatten() });
    }

    try {
      const application = await onboardSvc.apply({ userId, ...parsed.data });
      log.info('Merchant application submitted', { userId, appId: application.id });
      return res.status(201).json({ application });
    } catch (err) {
      return res.status(409).json({ error: (err as Error).message });
    }
  }),
);

// ─── GET /merchants/application ─────────────────────────
// Auth: get user's own application status

router.get(
  '/merchants/application',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const application = await onboardSvc.getUserApplication(userId);
    if (!application) {
      return res.status(404).json({ error: 'No tienes una solicitud activa.' });
    }
    return res.json({ application });
  }),
);

// ─── GET /admin/merchants/queue ─────────────────────────
// Admin: get pending applications

router.get(
  '/admin/merchants/queue',
  requireAdminKey,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const queue = await onboardSvc.getReviewQueue(limit);
    return res.json({ queue, count: queue.length });
  }),
);

// ─── GET /admin/merchants/applications/:id ──────────────
// Admin: get application detail

router.get(
  '/admin/merchants/applications/:id',
  requireAdminKey,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const application = await onboardSvc.getApplication(req.params.id);
    if (!application) {
      return res.status(404).json({ error: 'Solicitud no encontrada.' });
    }
    return res.json({ application });
  }),
);

// ─── POST /admin/merchants/applications/:id/review ──────
// Admin: approve or reject

router.post(
  '/admin/merchants/applications/:id/review',
  requireAdminKey,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const parsed = reviewSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.' });
    }

    const application = await onboardSvc.review(
      req.params.id,
      parsed.data.status,
      parsed.data.notes,
    );
    if (!application) {
      return res.status(404).json({ error: 'Solicitud no encontrada o no revisable.' });
    }

    log.info('Merchant application reviewed', { appId: req.params.id, status: parsed.data.status });
    return res.json({ application });
  }),
);

// ─── POST /admin/merchants/applications/:id/suspend ─────
// Admin: suspend an approved merchant

router.post(
  '/admin/merchants/applications/:id/suspend',
  requireAdminKey,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const reason = (req.body?.reason as string) || 'Suspendido por administrador';
    const application = await onboardSvc.suspend(req.params.id, reason);
    if (!application) {
      return res.status(404).json({ error: 'Comercio no encontrado o no aprobado.' });
    }
    return res.json({ application });
  }),
);

export default router;
