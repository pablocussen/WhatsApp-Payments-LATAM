import { Router } from 'express';
import type { Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/jwt.middleware';
import { asyncHandler } from '../utils/async-handler';
import { receipts } from '../services/receipt.service';

const router = Router();

// ─── GET /receipts/search ──────────────────────────────
// NOTE: Must be before /receipts/:id to avoid "search" matching as :id

router.get(
  '/receipts/search',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const ref = req.query.ref as string | undefined;
    if (!ref) {
      return res.status(400).json({ error: 'Parámetro ref requerido.' });
    }

    const result = await receipts.findByReference(req.user!.userId, ref);
    return res.json({ receipt: result ?? null });
  }),
);

// ─── GET /receipts ─────────────────────────────────────

router.get(
  '/receipts',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const list = await receipts.getUserReceipts(req.user!.userId);
    return res.json({ receipts: list, count: list.length });
  }),
);

// ─── GET /receipts/:id ─────────────────────────────────

router.get(
  '/receipts/:id',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const receipt = await receipts.getReceipt(req.params.id);
    if (!receipt) {
      return res.status(404).json({ error: 'Recibo no encontrado.' });
    }
    return res.json({ receipt });
  }),
);

export default router;
