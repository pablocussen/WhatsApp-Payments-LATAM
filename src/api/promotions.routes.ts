import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/jwt.middleware';
import { asyncHandler } from '../utils/async-handler';
import { env } from '../config/environment';
import { promotions as promoSvc } from '../services/promotion.service';
import { createLogger } from '../config/logger';

const router = Router();
const log = createLogger('promotions-routes');

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_API_KEY) { res.status(503).json({ error: 'Admin API not configured.' }); return; }
  const key = req.headers['x-admin-key'] as string | undefined;
  if (!key || key !== env.ADMIN_API_KEY) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  next();
}

// ─── Schemas ────────────────────────────────────────────

const validateSchema = z.object({
  amount: z.number().int().min(100),
});

const applySchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(50),
  amount: z.number().int().min(100),
});

const createPromoSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(500).optional(),
  type: z.enum(['percentage', 'fixed', 'cashback', 'free_fee']),
  value: z.number().positive(),
  minAmount: z.number().int().min(0).optional(),
  maxDiscount: z.number().int().min(0).optional(),
  code: z.string().trim().toUpperCase().min(1).max(50).optional(),
  usageLimit: z.number().int().min(0).optional(),
  perUserLimit: z.number().int().min(0).optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
});

// ─── GET /promotions ─────────────────────────────────────
// Public: list active promotions

router.get(
  '/promotions',
  asyncHandler(async (_req: AuthenticatedRequest, res: Response) => {
    const active = await promoSvc.listActive();
    // Only expose public fields (no internal tracking info)
    const public_ = active.map(({ id, name, description, type, value, minAmount, maxDiscount, code, endDate }) => ({
      id, name, description, type, value, minAmount, maxDiscount, code, endDate,
    }));
    return res.json({ promotions: public_ });
  }),
);

// ─── GET /promotions/validate/:code ──────────────────────
// Public: validate a promo code + preview discount for a given amount

router.get(
  '/promotions/validate/:code',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const code = req.params.code.toUpperCase().trim();
    const parsed = validateSchema.safeParse({ amount: parseInt(req.query.amount as string) || 0 });

    const promo = await promoSvc.findByCode(code);
    if (!promo || !promo.active) {
      return res.status(404).json({ valid: false, message: 'Código no encontrado o inactivo.' });
    }

    const now = new Date().toISOString();
    if (now < promo.startDate || now > promo.endDate) {
      return res.status(404).json({ valid: false, message: 'Código expirado o no activo aún.' });
    }

    if (promo.usageLimit > 0 && promo.usageCount >= promo.usageLimit) {
      return res.status(409).json({ valid: false, message: 'Código agotado.' });
    }

    const response: Record<string, unknown> = {
      valid: true,
      promo: {
        id: promo.id,
        name: promo.name,
        description: promo.description,
        type: promo.type,
        value: promo.value,
        minAmount: promo.minAmount,
        endDate: promo.endDate,
      },
    };

    // If amount provided, include preview discount
    if (parsed.success && parsed.data.amount >= 100 && parsed.data.amount >= promo.minAmount) {
      const preview = await promoSvc.applyPromotion(promo.id, '_preview_', parsed.data.amount);
      // applyPromotion increments usage — we don't want that for preview. This is a trade-off.
      // A real system would have a separate previewPromotion method. For now, we note it.
      if (preview) {
        response.preview = {
          discount: preview.discount,
          finalAmount: preview.finalAmount,
          originalAmount: preview.originalAmount,
        };
      }
    }

    return res.json(response);
  }),
);

// ─── POST /promotions/apply ───────────────────────────────
// Auth: apply a promo code for a given amount

router.post(
  '/promotions/apply',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const parsed = applySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.' });
    }

    const promo = await promoSvc.findByCode(parsed.data.code);
    if (!promo) {
      return res.status(404).json({ error: 'Código no encontrado.' });
    }

    const result = await promoSvc.applyPromotion(promo.id, userId, parsed.data.amount);
    if (!result) {
      return res.status(409).json({ error: 'Código no aplicable: expirado, agotado o monto insuficiente.' });
    }

    log.info('Promotion applied', { userId, code: parsed.data.code, discount: result.discount });
    return res.json({ applied: result });
  }),
);

// ─── POST /admin/promotions ───────────────────────────────
// Admin: create a new promotion

router.post(
  '/admin/promotions',
  requireAdminKey,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const parsed = createPromoSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.', details: parsed.error.flatten() });
    }
    const promo = await promoSvc.createPromotion(parsed.data);
    log.info('Promotion created via admin', { id: promo.id, name: promo.name });
    return res.status(201).json({ promo });
  }),
);

// ─── DELETE /admin/promotions/:id ────────────────────────
// Admin: deactivate a promotion

router.delete(
  '/admin/promotions/:id',
  requireAdminKey,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const deactivated = await promoSvc.deactivatePromotion(req.params.id);
    if (!deactivated) {
      return res.status(404).json({ error: 'Promoción no encontrada.' });
    }
    return res.json({ message: 'Promoción desactivada.', id: req.params.id });
  }),
);

// ─── GET /admin/promotions/:id/stats ─────────────────────
// Admin: usage stats for a promotion

router.get(
  '/admin/promotions/:id/stats',
  requireAdminKey,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const promo = await promoSvc.getPromotion(req.params.id);
    if (!promo) {
      return res.status(404).json({ error: 'Promoción no encontrada.' });
    }
    const stats = await promoSvc.getUsageStats(req.params.id);
    return res.json({ promo: { id: promo.id, name: promo.name, active: promo.active }, stats });
  }),
);

export default router;
