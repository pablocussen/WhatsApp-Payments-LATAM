import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/async-handler';
import { env } from '../config/environment';
import { feeConfig } from '../services/fee-config.service';

const router = Router();

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_API_KEY) { res.status(503).json({ error: 'Admin API not configured.' }); return; }
  const key = req.headers['x-admin-key'] as string | undefined;
  if (!key || key !== env.ADMIN_API_KEY) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  next();
}

// ─── Schemas ────────────────────────────────────────────

const paymentMethodEnum = z.enum(['WALLET', 'WEBPAY_CREDIT', 'WEBPAY_DEBIT', 'KHIPU']);

const feeRuleSchema = z.object({
  method: paymentMethodEnum,
  percentFee: z.number().min(0).max(50),
  fixedFee: z.number().min(0),
  minFee: z.number().min(0),
  maxFee: z.number().min(0),
});

const setMerchantFeesSchema = z.object({
  rules: z.array(feeRuleSchema),
});

const calculateFeeSchema = z.object({
  merchantId: z.string().optional(),
  amount: z.number().int().min(100),
  method: paymentMethodEnum,
});

// ─── GET /admin/fees/defaults ───────────────────────────
// Admin: get platform default fee rules

router.get(
  '/admin/fees/defaults',
  requireAdminKey,
  asyncHandler(async (_req: Request, res: Response) => {
    const defaults = await feeConfig.getPlatformDefaults();
    return res.json({ defaults });
  }),
);

// ─── GET /admin/fees/merchant/:merchantId ───────────────
// Admin: get merchant fee config

router.get(
  '/admin/fees/merchant/:merchantId',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const config = await feeConfig.getMerchantConfig(req.params.merchantId);
    if (!config) {
      return res.status(404).json({ error: 'Merchant fee config not found.' });
    }
    return res.json({ config });
  }),
);

// ─── POST /admin/fees/merchant/:merchantId ──────────────
// Admin: set merchant fee overrides

router.post(
  '/admin/fees/merchant/:merchantId',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = setMerchantFeesSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.', details: parsed.error.flatten() });
    }

    try {
      const config = await feeConfig.setMerchantFees(req.params.merchantId, parsed.data.rules);
      return res.status(201).json({ config });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }),
);

// ─── DELETE /admin/fees/merchant/:merchantId ────────────
// Admin: remove merchant fee override

router.delete(
  '/admin/fees/merchant/:merchantId',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    await feeConfig.removeMerchantFees(req.params.merchantId);
    return res.json({ ok: true });
  }),
);

// ─── POST /admin/fees/calculate ─────────────────────────
// Admin: calculate fee for a given amount and method

router.post(
  '/admin/fees/calculate',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = calculateFeeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.', details: parsed.error.flatten() });
    }

    const { merchantId, amount, method } = parsed.data;
    const calculation = await feeConfig.calculateFee(merchantId ?? null, amount, method);
    return res.json({ calculation });
  }),
);

export default router;
