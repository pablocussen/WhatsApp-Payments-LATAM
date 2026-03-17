import { Router, Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/jwt.middleware';
import { asyncHandler } from '../utils/async-handler';
import { referral as referralSvc } from '../services/referral.service';
import { createLogger } from '../config/logger';
import { env } from '../config/environment';

const router = Router();
const log = createLogger('referral-routes');

// ─── Schemas ────────────────────────────────────────────

const applyCodeSchema = z.object({
  code: z.string().trim().toUpperCase().min(1).max(20),
});

// ─── GET /referrals/my-code ──────────────────────────────
// Get or generate the authenticated user's referral code

router.get(
  '/referrals/my-code',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const codeObj = await referralSvc.generateCode(userId);
    const shareLink = `${env.APP_BASE_URL}/invita/${codeObj.code}`;
    return res.json({ code: codeObj, shareLink });
  }),
);

// ─── GET /referrals/stats ────────────────────────────────
// Get referral stats for authenticated user

router.get(
  '/referrals/stats',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const [codeObj, stats, referrals] = await Promise.all([
      referralSvc.getUserCode(userId),
      referralSvc.getStats(userId),
      referralSvc.getUserReferrals(userId),
    ]);
    return res.json({ code: codeObj?.code ?? null, stats, referrals });
  }),
);

// ─── POST /referrals/apply ───────────────────────────────
// Apply a referral code for the authenticated user

router.post(
  '/referrals/apply',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user!.userId;
    const parsed = applyCodeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Código de referido inválido.' });
    }
    const result = await referralSvc.applyCode(parsed.data.code, userId);
    if (!result.success) {
      return res.status(409).json({ error: result.message });
    }
    log.info('Referral code applied via API', { userId, code: parsed.data.code });
    return res.json({ message: result.message, referral: result.referral });
  }),
);

// ─── GET /referrals/validate/:code ──────────────────────
// Public: validate that a code is active (for registration flow)

router.get(
  '/referrals/validate/:code',
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const code = req.params.code.toUpperCase().trim();
    const codeObj = await referralSvc.getCode(code);
    if (!codeObj || !codeObj.active || codeObj.usageCount >= codeObj.maxUses) {
      return res.status(404).json({ valid: false, message: 'Código no válido o inactivo.' });
    }
    return res.json({
      valid: true,
      rewardForReferred: codeObj.rewardForReferred,
      message: `¡Código válido! Recibirás $${codeObj.rewardForReferred.toLocaleString('es-CL')} CLP al registrarte.`,
    });
  }),
);

export default router;
