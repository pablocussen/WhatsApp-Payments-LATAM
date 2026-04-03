import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/jwt.middleware';
import { asyncHandler } from '../utils/async-handler';
import { rateLimitAction } from '../middleware/auth.middleware';
import { splitPayment } from '../services/split-payment.service';

const router = Router();

// ─── Schemas ────────────────────────────────────────────

const createSchema = z.object({
  creatorName: z.string().trim().min(1).max(50),
  description: z.string().trim().min(1).max(100),
  totalAmount: z.number().int().min(200).max(50_000_000),
  splitMethod: z.enum(['equal', 'custom']),
  participants: z.array(z.object({
    phone: z.string().trim().regex(/^\+?\d{8,15}$/),
    name: z.string().trim().min(1).max(50),
    amount: z.number().int().min(100).optional(),
  })).min(1).max(20),
});

// ─── POST /splits (USER) ───────────────────────────────

router.post(
  '/splits',
  requireAuth,
  rateLimitAction('split:create'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.', details: parsed.error.flatten() });
    }

    try {
      const split = await splitPayment.createSplit({
        createdBy: req.user!.userId,
        ...parsed.data,
      });
      return res.status(201).json({ split });
    } catch (err) {
      return res.status(409).json({ error: (err as Error).message });
    }
  }),
);

// ─── GET /splits (USER) ────────────────────────────────

router.get(
  '/splits',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const splits = await splitPayment.getUserSplits(req.user!.userId);
    return res.json({ splits, count: splits.length });
  }),
);

// ─── GET /splits/:id (USER) ────────────────────────────

router.get(
  '/splits/:id',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const split = await splitPayment.getSplit(req.params.id);
    if (!split) {
      return res.status(404).json({ error: 'Split no encontrado.' });
    }
    const summary = splitPayment.formatSplitSummary(split);
    return res.json({ split, summary });
  }),
);

// ─── POST /splits/:id/pay (USER) ───────────────────────

router.post(
  '/splits/:id/pay',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { phone, transactionRef } = req.body;
    if (!phone || !transactionRef) {
      return res.status(400).json({ error: 'phone y transactionRef requeridos.' });
    }

    try {
      const split = await splitPayment.recordPayment(req.params.id, phone, transactionRef);
      if (!split) {
        return res.status(404).json({ error: 'Split no encontrado.' });
      }
      return res.json({ split });
    } catch (err) {
      return res.status(409).json({ error: (err as Error).message });
    }
  }),
);

// ─── POST /splits/:id/decline (USER) ───────────────────

router.post(
  '/splits/:id/decline',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ error: 'phone requerido.' });
    }

    const declined = await splitPayment.declineParticipation(req.params.id, phone);
    if (!declined) {
      return res.status(404).json({ error: 'Participante no encontrado o ya respondió.' });
    }
    return res.json({ message: 'Participación rechazada.' });
  }),
);

// ─── DELETE /splits/:id (USER — cancel own split) ──────

router.delete(
  '/splits/:id',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const cancelled = await splitPayment.cancelSplit(req.params.id, req.user!.userId);
    if (!cancelled) {
      return res.status(404).json({ error: 'Split no encontrado o no cancelable.' });
    }
    return res.json({ message: 'Split cancelado.' });
  }),
);

export default router;
