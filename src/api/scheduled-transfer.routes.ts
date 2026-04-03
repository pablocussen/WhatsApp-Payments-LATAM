import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/jwt.middleware';
import { asyncHandler } from '../utils/async-handler';
import { rateLimitAction } from '../middleware/auth.middleware';
import { scheduledTransfer } from '../services/scheduled-transfer.service';

const router = Router();

const createSchema = z.object({
  receiverPhone: z.string().trim().regex(/^\+?\d{8,15}$/),
  receiverName: z.string().trim().min(1).max(50),
  amount: z.number().int().min(100).max(50_000_000),
  description: z.string().trim().min(1).max(100),
  frequency: z.enum(['once', 'weekly', 'biweekly', 'monthly']),
  scheduledDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scheduledTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
});

// ─── POST /scheduled-transfers ──────────────────────────

router.post(
  '/scheduled-transfers',
  requireAuth,
  rateLimitAction('transfer:create'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos invalidos.', details: parsed.error.flatten() });
    }

    try {
      const transfer = await scheduledTransfer.schedule({
        senderId: req.user!.userId,
        ...parsed.data,
      });
      return res.status(201).json({ transfer });
    } catch (err) {
      return res.status(409).json({ error: (err as Error).message });
    }
  }),
);

// ─── GET /scheduled-transfers ───────────────────────────

router.get(
  '/scheduled-transfers',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const transfers = await scheduledTransfer.getUserTransfers(req.user!.userId);
    return res.json({ transfers, count: transfers.length });
  }),
);

// ─── GET /scheduled-transfers/:id ───────────────────────

router.get(
  '/scheduled-transfers/:id',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const transfer = await scheduledTransfer.getTransfer(req.params.id);
    if (!transfer) {
      return res.status(404).json({ error: 'Transferencia no encontrada.' });
    }
    return res.json({ transfer });
  }),
);

// ─── DELETE /scheduled-transfers/:id ────────────────────

router.delete(
  '/scheduled-transfers/:id',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const cancelled = await scheduledTransfer.cancel(req.params.id, req.user!.userId);
    if (!cancelled) {
      return res.status(404).json({ error: 'Transferencia no encontrada o no cancelable.' });
    }
    return res.json({ message: 'Transferencia cancelada.' });
  }),
);

export default router;
