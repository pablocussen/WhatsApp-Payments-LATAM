import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/jwt.middleware';
import { asyncHandler } from '../utils/async-handler';
import { rateLimitAction } from '../middleware/auth.middleware';
import { paymentRequest } from '../services/payment-request.service';

const router = Router();

const createSchema = z.object({
  requesterName: z.string().trim().min(1).max(50),
  requesterPhone: z.string().trim().regex(/^\+?\d{8,15}$/),
  targetPhone: z.string().trim().regex(/^\+?\d{8,15}$/),
  targetName: z.string().trim().max(50).optional(),
  amount: z.number().int().min(100).max(50_000_000),
  description: z.string().trim().min(1).max(100),
  expiresInHours: z.number().int().min(1).max(168).optional(), // max 7 days
});

// ─── POST /payment-requests ─────────────────────────────

router.post(
  '/payment-requests',
  requireAuth,
  rateLimitAction('request:create'),
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.', details: parsed.error.flatten() });
    }

    try {
      const request = await paymentRequest.createRequest({
        requesterId: req.user!.userId,
        ...parsed.data,
      });
      return res.status(201).json({ request });
    } catch (err) {
      return res.status(409).json({ error: (err as Error).message });
    }
  }),
);

// ─── GET /payment-requests/sent ─────────────────────────

router.get(
  '/payment-requests/sent',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const requests = await paymentRequest.getSentRequests(req.user!.userId);
    return res.json({ requests, count: requests.length });
  }),
);

// ─── GET /payment-requests/received ─────────────────────

router.get(
  '/payment-requests/received',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const phone = req.query.phone as string;
    if (!phone) return res.status(400).json({ error: 'Parámetro phone requerido.' });
    const requests = await paymentRequest.getReceivedRequests(phone);
    return res.json({ requests, count: requests.length });
  }),
);

// ─── GET /payment-requests/:id ──────────────────────────

router.get(
  '/payment-requests/:id',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const request = await paymentRequest.getRequest(req.params.id);
    if (!request) return res.status(404).json({ error: 'Solicitud no encontrada.' });
    return res.json({ request });
  }),
);

// ─── POST /payment-requests/:id/pay ────────────────────

router.post(
  '/payment-requests/:id/pay',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const { transactionRef } = req.body;
    if (!transactionRef) return res.status(400).json({ error: 'transactionRef requerido.' });

    try {
      const request = await paymentRequest.payRequest(req.params.id, transactionRef);
      if (!request) return res.status(404).json({ error: 'Solicitud no encontrada.' });
      return res.json({ request });
    } catch (err) {
      return res.status(409).json({ error: (err as Error).message });
    }
  }),
);

// ─── POST /payment-requests/:id/decline ────────────────

router.post(
  '/payment-requests/:id/decline',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const request = await paymentRequest.declineRequest(req.params.id);
    if (!request) return res.status(404).json({ error: 'Solicitud no encontrada o ya respondida.' });
    return res.json({ request });
  }),
);

// ─── DELETE /payment-requests/:id ──────────────────────

router.delete(
  '/payment-requests/:id',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const cancelled = await paymentRequest.cancelRequest(req.params.id, req.user!.userId);
    if (!cancelled) return res.status(404).json({ error: 'Solicitud no encontrada o no cancelable.' });
    return res.json({ message: 'Solicitud cancelada.' });
  }),
);

export default router;
