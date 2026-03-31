import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/async-handler';
import { env } from '../config/environment';
import { settlement as settlementSvc } from '../services/settlement.service';

const router = Router();

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_API_KEY) { res.status(503).json({ error: 'Admin API not configured.' }); return; }
  const key = req.headers['x-admin-key'] as string | undefined;
  if (!key || key !== env.ADMIN_API_KEY) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  next();
}

// ─── Schemas ────────────────────────────────────────────

const setConfigSchema = z.object({
  merchantId: z.string(),
  frequency: z.enum(['daily', 'weekly', 'biweekly', 'monthly']),
  bankName: z.string().max(100),
  accountNumber: z.string().max(30),
  accountType: z.enum(['corriente', 'vista', 'ahorro']),
  holderName: z.string().max(100),
  holderRut: z.string().regex(/^\d{7,8}-[\dkK]$/),
});

const createSettlementSchema = z.object({
  merchantId: z.string(),
  amount: z.number().int().min(1),
  fee: z.number().int().min(0),
  transactionCount: z.number().int().min(0),
  periodStart: z.string(),
  periodEnd: z.string(),
});

const processSchema = z.object({
  transferReference: z.string(),
});

const cancelSchema = z.object({
  reason: z.string(),
});

// ─── GET /admin/settlements/merchant/:merchantId ────────
// Admin: list merchant settlements

router.get(
  '/admin/settlements/merchant/:merchantId',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const settlements = await settlementSvc.getMerchantSettlements(req.params.merchantId);
    return res.json({ settlements });
  }),
);

// ─── GET /admin/settlements/config/:merchantId ──────────
// Admin: get settlement config

router.get(
  '/admin/settlements/config/:merchantId',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const config = await settlementSvc.getConfig(req.params.merchantId);
    if (!config) {
      return res.status(404).json({ error: 'Settlement config not found.' });
    }
    return res.json({ config });
  }),
);

// ─── GET /admin/settlements/merchant/:merchantId/summary
// Admin: get pending summary

router.get(
  '/admin/settlements/merchant/:merchantId/summary',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const summary = await settlementSvc.getPendingSummary(req.params.merchantId);
    return res.json({ summary });
  }),
);

// ─── GET /admin/settlements/:id ─────────────────────────
// Admin: get settlement detail

router.get(
  '/admin/settlements/:id',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const s = await settlementSvc.getSettlement(req.params.id);
    if (!s) {
      return res.status(404).json({ error: 'Settlement not found.' });
    }
    return res.json({ settlement: s });
  }),
);

// ─── POST /admin/settlements/config ─────────────────────
// Admin: set merchant settlement config

router.post(
  '/admin/settlements/config',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = setConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.', details: parsed.error.flatten() });
    }

    const config = await settlementSvc.setConfig(parsed.data);
    return res.status(201).json({ config });
  }),
);

// ─── POST /admin/settlements ────────────────────────────
// Admin: create a settlement

router.post(
  '/admin/settlements',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = createSettlementSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.', details: parsed.error.flatten() });
    }

    const s = await settlementSvc.createSettlement(parsed.data);
    return res.status(201).json({ settlement: s });
  }),
);

// ─── POST /admin/settlements/:id/process ────────────────
// Admin: process a settlement

router.post(
  '/admin/settlements/:id/process',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = processSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.' });
    }

    try {
      const s = await settlementSvc.processSettlement(req.params.id, parsed.data.transferReference);
      return res.json({ settlement: s });
    } catch (err) {
      return res.status(409).json({ error: (err as Error).message });
    }
  }),
);

// ─── POST /admin/settlements/:id/cancel ─────────────────
// Admin: cancel a settlement

router.post(
  '/admin/settlements/:id/cancel',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = cancelSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.' });
    }

    try {
      const s = await settlementSvc.cancelSettlement(req.params.id, parsed.data.reason);
      return res.json({ settlement: s });
    } catch (err) {
      return res.status(409).json({ error: (err as Error).message });
    }
  }),
);

export default router;
