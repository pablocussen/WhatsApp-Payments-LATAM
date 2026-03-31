import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/jwt.middleware';
import { asyncHandler } from '../utils/async-handler';
import { notificationPrefs } from '../services/notification-prefs.service';

const router = Router();

// ─── Schemas ────────────────────────────────────────────

const updatePrefsSchema = z.object({
  enabled: z.boolean().optional(),
  quietHoursEnabled: z.boolean().optional(),
  quietStart: z.number().int().min(0).max(23).optional(),
  quietEnd: z.number().int().min(0).max(23).optional(),
});

// ─── GET /notification-prefs ───────────────────────────

router.get(
  '/notification-prefs',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prefs = await notificationPrefs.get(req.user!.userId);
    return res.json({ prefs });
  }),
);

// ─── POST /notification-prefs ──────────────────────────

router.post(
  '/notification-prefs',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const parsed = updatePrefsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.', details: parsed.error.flatten() });
    }

    const prefs = await notificationPrefs.set(req.user!.userId, parsed.data);
    return res.json({ prefs });
  }),
);

export default router;
