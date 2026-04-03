import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { asyncHandler } from '../utils/async-handler';
import { rateLimitAction } from '../middleware/auth.middleware';

const router = Router();
const log = createLogger('waitlist');

export const WAITLIST_KEY = 'waitlist:emails';

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});

// ─── Public: Join Waitlist ──────────────────────────────

router.post(
  '/waitlist',
  rateLimitAction('waitlist:join'),
  asyncHandler(async (req: Request, res: Response) => {
    // Per-IP rate limit: 5 signups/hour
    const ip = req.ip || 'unknown';
    const rlKey = `rl:waitlist:${ip}`;
    const redis = getRedis();
    try {
      const count = await redis.incr(rlKey);
      if (count === 1) await redis.expire(rlKey, 3600);
      if (count > 5) {
        return res.status(429).json({ error: 'Demasiados intentos. Intenta en una hora.' });
      }
    } catch {
      // fail-open: allow if Redis rate limit check fails
    }

    const parsed = emailSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Email inválido.' });
    }

    const email = parsed.data.email;
    const added = await redis.sAdd(WAITLIST_KEY, email);

    if (added === 0) {
      return res.json({ status: 'already_registered', message: 'Ya estás en la lista.' });
    }

    log.info('Waitlist signup', { email: email.replace(/(.{2}).*@/, '$1***@') });
    return res.json({ status: 'ok', message: '¡Te avisaremos cuando lancemos!' });
  }),
);

// ─── Public: Waitlist Count ────────────────────────────

router.get(
  '/waitlist/count',
  asyncHandler(async (_req: Request, res: Response) => {
    const redis = getRedis();
    const count = await redis.sCard(WAITLIST_KEY);
    return res.json({ count });
  }),
);

export default router;
