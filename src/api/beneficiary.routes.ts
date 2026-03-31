import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/jwt.middleware';
import { asyncHandler } from '../utils/async-handler';
import { beneficiaries } from '../services/beneficiary.service';

const router = Router();

// ─── GET /beneficiaries ─────────────────────────────────

router.get(
  '/beneficiaries',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const list = await beneficiaries.getBeneficiaries(req.user!.userId);
    return res.json({ beneficiaries: list, count: list.length });
  }),
);

// ─── POST /beneficiaries ────────────────────────────────

const addSchema = z.object({
  name: z.string().trim().min(1).max(50),
  phone: z.string().trim().regex(/^\+?\d{8,15}$/, 'Teléfono inválido'),
  alias: z.string().trim().max(20).optional(),
  defaultAmount: z.number().int().min(100).max(50_000_000).optional(),
});

router.post(
  '/beneficiaries',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const parsed = addSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.', details: parsed.error.flatten() });
    }

    try {
      const bene = await beneficiaries.addBeneficiary({
        userId: req.user!.userId,
        ...parsed.data,
      });
      return res.status(201).json({ beneficiary: bene });
    } catch (err) {
      return res.status(409).json({ error: (err as Error).message });
    }
  }),
);

// ─── POST /beneficiaries/:id/update ─────────────────────

const updateSchema = z.object({
  name: z.string().trim().min(1).max(50).optional(),
  alias: z.string().trim().max(20).nullable().optional(),
  defaultAmount: z.number().int().min(100).max(50_000_000).nullable().optional(),
});

router.post(
  '/beneficiaries/:id/update',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.' });
    }

    try {
      const bene = await beneficiaries.updateBeneficiary(
        req.user!.userId,
        req.params.id,
        parsed.data,
      );
      if (!bene) {
        return res.status(404).json({ error: 'Beneficiario no encontrado.' });
      }
      return res.json({ beneficiary: bene });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }),
);

// ─── DELETE /beneficiaries/:id ──────────────────────────

router.delete(
  '/beneficiaries/:id',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const removed = await beneficiaries.removeBeneficiary(req.user!.userId, req.params.id);
    if (!removed) {
      return res.status(404).json({ error: 'Beneficiario no encontrado.' });
    }
    return res.json({ message: 'Beneficiario eliminado.' });
  }),
);

// ─── GET /beneficiaries/search ──────────────────────────

router.get(
  '/beneficiaries/search',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const phone = req.query.phone as string;
    if (!phone) {
      return res.status(400).json({ error: 'Parámetro phone requerido.' });
    }
    const bene = await beneficiaries.findByPhone(req.user!.userId, phone);
    return res.json({ beneficiary: bene ?? null });
  }),
);

export default router;
