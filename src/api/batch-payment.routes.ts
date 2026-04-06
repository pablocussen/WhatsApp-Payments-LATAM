import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/jwt.middleware';
import { rateLimitAction } from '../middleware/auth.middleware';
import { idempotency } from '../middleware/idempotency.middleware';
import { asyncHandler } from '../utils/async-handler';
import { batchPayments } from '../services/batch-payment.service';

const router = Router();

// ─── POST /batch-payments ──────────────────────────────
// Process a batch of payments at once (payroll, distributions)

router.post(
  '/batch-payments',
  requireAuth,
  rateLimitAction('payment:create'),
  idempotency(),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'items debe ser un array de pagos.' });
    }

    const batch = await batchPayments.processBatch({
      senderId: req.user!.userId,
      senderWaId: req.user!.waId ?? '',
      items,
    });

    const statusCode = batch.status === 'completed' ? 201 :
                        batch.status === 'partial' ? 207 :
                        batch.status === 'failed' ? 422 : 201;

    return res.status(statusCode).json({
      batch: {
        id: batch.id,
        status: batch.status,
        totalAmount: batch.totalAmount,
        totalFees: batch.totalFees,
        successCount: batch.successCount,
        failCount: batch.failCount,
        createdAt: batch.createdAt,
        completedAt: batch.completedAt,
      },
      results: batch.results,
    });
  }),
);

// ─── GET /batch-payments/:id ───────────────────────────

router.get(
  '/batch-payments/:id',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const batch = await batchPayments.getBatch(req.params.id);
    if (!batch) {
      return res.status(404).json({ error: 'Lote no encontrado.' });
    }

    // Only the sender can view their batch
    if (batch.senderId !== req.user!.userId) {
      return res.status(403).json({ error: 'No tienes acceso a este lote.' });
    }

    return res.json({ batch });
  }),
);

export default router;
