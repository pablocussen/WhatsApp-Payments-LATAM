import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/jwt.middleware';
import { asyncHandler } from '../utils/async-handler';
import { env } from '../config/environment';
import { qrPayment } from '../services/qr-payment.service';

const router = Router();

// ─── POST /qr/generate (USER) ──────────────────────────

const generateSchema = z.object({
  type: z.enum(['static', 'dynamic']),
  merchantId: z.string().trim().optional(),
  amount: z.number().int().min(100).max(50_000_000).optional(),
  description: z.string().trim().max(100).optional(),
  expiresInMinutes: z.number().int().min(1).max(1440).optional(), // max 24h
});

router.post(
  '/qr/generate',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.', details: parsed.error.flatten() });
    }

    try {
      const qr = await qrPayment.generateQr({
        createdBy: req.user!.userId,
        ...parsed.data,
      });

      const qrPayload = qrPayment.getQrPayload(qr.reference, env.APP_BASE_URL);

      return res.status(201).json({
        qr,
        qrPayload,
        scanUrl: `${env.APP_BASE_URL}/api/v1/qr/scan/${qr.reference}`,
      });
    } catch (err) {
      return res.status(409).json({ error: (err as Error).message });
    }
  }),
);

// ─── GET /qr/my (USER) ─────────────────────────────────

router.get(
  '/qr/my',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const qrs = await qrPayment.getUserQrs(req.user!.userId);
    return res.json({ qrCodes: qrs, count: qrs.length });
  }),
);

// ─── GET /qr/scan/:reference (PUBLIC) ───────────────────

router.get(
  '/qr/scan/:reference',
  asyncHandler(async (req: Request, res: Response) => {
    const qr = await qrPayment.resolveQr(req.params.reference);
    if (!qr) {
      return res.status(404).json({ error: 'Código QR no encontrado.' });
    }
    if (qr.status === 'expired') {
      return res.status(410).json({ error: 'Código QR expirado.', qr });
    }
    if (qr.status === 'used') {
      return res.status(410).json({ error: 'Código QR ya utilizado.', qr });
    }
    if (qr.status === 'cancelled') {
      return res.status(410).json({ error: 'Código QR cancelado.' });
    }
    return res.json({
      qr: {
        reference: qr.reference,
        type: qr.type,
        amount: qr.amount,
        description: qr.description,
        merchantId: qr.merchantId,
        createdBy: qr.createdBy,
      },
    });
  }),
);

// ─── POST /qr/:id/use (USER) ───────────────────────────

router.post(
  '/qr/:id/use',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const transactionRef = req.body?.transactionRef as string;
    if (!transactionRef) {
      return res.status(400).json({ error: 'transactionRef requerido.' });
    }

    try {
      const qr = await qrPayment.markUsed(req.params.id, req.user!.userId, transactionRef);
      if (!qr) {
        return res.status(404).json({ error: 'QR no encontrado.' });
      }
      return res.json({ qr });
    } catch (err) {
      return res.status(409).json({ error: (err as Error).message });
    }
  }),
);

// ─── DELETE /qr/:id (USER — cancel own QR) ─────────────

router.delete(
  '/qr/:id',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const cancelled = await qrPayment.cancelQr(req.params.id, req.user!.userId);
    if (!cancelled) {
      return res.status(404).json({ error: 'QR no encontrado o no cancelable.' });
    }
    return res.json({ message: 'Código QR cancelado.' });
  }),
);

export default router;
