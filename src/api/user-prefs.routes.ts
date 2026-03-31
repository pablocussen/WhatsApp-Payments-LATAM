import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/jwt.middleware';
import { asyncHandler } from '../utils/async-handler';
import { userPrefs } from '../services/user-prefs.service';

const router = Router();

// ─── GET /preferences ───────────────────────────────────

router.get(
  '/preferences',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prefs = await userPrefs.getPrefs(req.user!.userId);
    return res.json({ preferences: prefs });
  }),
);

// ─── POST /preferences ──────────────────────────────────

const updateSchema = z.object({
  language: z.enum(['es', 'en']).optional(),
  receiptFormat: z.enum(['short', 'detailed']).optional(),
  confirmBeforePay: z.boolean().optional(),
  showBalanceOnGreet: z.boolean().optional(),
  defaultTipPercent: z.number().int().min(0).max(20).optional(),
  nickName: z.string().trim().max(30).nullable().optional(),
});

router.post(
  '/preferences',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.', details: parsed.error.flatten() });
    }

    try {
      const prefs = await userPrefs.setPrefs(req.user!.userId, parsed.data);
      return res.json({ preferences: prefs });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }),
);

// ─── DELETE /preferences ────────────────────────────────

router.delete(
  '/preferences',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const prefs = await userPrefs.resetPrefs(req.user!.userId);
    return res.json({ preferences: prefs, message: 'Preferencias restauradas.' });
  }),
);

export default router;
