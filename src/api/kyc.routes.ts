import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/jwt.middleware';
import { asyncHandler } from '../utils/async-handler';
import { env } from '../config/environment';
import { kycDocument as kycSvc } from '../services/kyc-document.service';
import { createLogger } from '../config/logger';

const router = Router();
const log = createLogger('kyc-routes');

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_API_KEY) { res.status(503).json({ error: 'Admin API not configured.' }); return; }
  const key = req.headers['x-admin-key'] as string | undefined;
  if (!key || key !== env.ADMIN_API_KEY) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  next();
}

// ─── Schemas ────────────────────────────────────────────

const uploadSchema = z.object({
  type: z.enum(['cedula_frontal', 'cedula_reverso', 'selfie', 'comprobante_domicilio', 'certificado_actividades']),
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  fileSize: z.number().int().min(1).max(10 * 1024 * 1024),
  storageUrl: z.string().trim().min(1).max(500),
});

const startVerificationSchema = z.object({
  targetTier: z.enum(['INTERMEDIATE', 'FULL']),
});

const reviewDocSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  rejectionReason: z.string().trim().max(500).optional(),
});

const completeVerificationSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
  notes: z.string().trim().max(500).optional(),
});

// ─── POST /kyc/documents ────────────────────────────────
// Auth: upload a KYC document

router.post(
  '/kyc/documents',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const parsed = uploadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.', details: parsed.error.flatten() });
    }

    const doc = await kycSvc.uploadDocument({ userId, ...parsed.data });
    log.info('KYC document uploaded', { userId, docId: doc.id, type: doc.type });
    return res.status(201).json({ document: doc });
  }),
);

// ─── GET /kyc/documents ─────────────────────────────────
// Auth: list user's documents

router.get(
  '/kyc/documents',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const documents = await kycSvc.getUserDocuments(userId);
    const stats = await kycSvc.getDocumentStats(userId);
    return res.json({ documents, stats });
  }),
);

// ─── GET /kyc/requirements ──────────────────────────────
// Public: get KYC tier requirements

router.get(
  '/kyc/requirements',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const tier = req.query.tier as string | undefined;
    const requirements = kycSvc.getRequirements(tier as 'BASIC' | 'INTERMEDIATE' | 'FULL' | undefined);
    return res.json({ requirements });
  }),
);

// ─── GET /kyc/eligibility ───────────────────────────────
// Auth: check eligibility for a tier

router.get(
  '/kyc/eligibility',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const tier = (req.query.tier as string || 'INTERMEDIATE').toUpperCase();
    if (!['INTERMEDIATE', 'FULL'].includes(tier)) {
      return res.status(400).json({ error: 'Tier inválido.' });
    }
    const result = await kycSvc.checkTierEligibility(userId, tier as 'INTERMEDIATE' | 'FULL');
    return res.json(result);
  }),
);

// ─── POST /kyc/verify ───────────────────────────────────
// Auth: start verification process

router.post(
  '/kyc/verify',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const parsed = startVerificationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.' });
    }

    try {
      const verification = await kycSvc.startVerification(userId, parsed.data.targetTier);
      log.info('KYC verification started', { userId, verificationId: verification.id });
      return res.status(201).json({ verification });
    } catch (err) {
      return res.status(409).json({ error: (err as Error).message });
    }
  }),
);

// ─── GET /kyc/verifications ─────────────────────────────
// Auth: list user's verifications

router.get(
  '/kyc/verifications',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const verifications = await kycSvc.getUserVerifications(userId);
    return res.json({ verifications, count: verifications.length });
  }),
);

// ─── POST /admin/kyc/documents/:id/review ───────────────
// Admin: review a document

router.post(
  '/admin/kyc/documents/:id/review',
  requireAdminKey,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const parsed = reviewDocSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.' });
    }

    try {
      const doc = await kycSvc.reviewDocument(
        req.params.id,
        parsed.data.decision,
        'admin',
        parsed.data.rejectionReason,
      );
      if (!doc) {
        return res.status(404).json({ error: 'Documento no encontrado.' });
      }
      return res.json({ document: doc });
    } catch (err) {
      return res.status(409).json({ error: (err as Error).message });
    }
  }),
);

// ─── POST /admin/kyc/verifications/:id/complete ─────────
// Admin: complete a verification

router.post(
  '/admin/kyc/verifications/:id/complete',
  requireAdminKey,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const parsed = completeVerificationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.' });
    }

    try {
      const v = await kycSvc.completeVerification(
        req.params.id,
        parsed.data.decision,
        'admin',
        parsed.data.notes,
      );
      if (!v) {
        return res.status(404).json({ error: 'Verificación no encontrada.' });
      }
      return res.json({ verification: v });
    } catch (err) {
      return res.status(409).json({ error: (err as Error).message });
    }
  }),
);

export default router;
