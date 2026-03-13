import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { asyncHandler } from '../utils/async-handler';

const router = Router();
const log = createLogger('waitlist');

export const WAITLIST_KEY = 'waitlist:emails';

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
});

// ─── Public: Join Waitlist ──────────────────────────────

router.post(
  '/waitlist',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = emailSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Email inválido.' });
    }

    const email = parsed.data.email;
    const redis = getRedis();
    const added = await redis.sAdd(WAITLIST_KEY, email);

    if (added === 0) {
      return res.json({ status: 'already_registered', message: 'Ya estás en la lista.' });
    }

    log.info('Waitlist signup', { email: email.replace(/(.{2}).*@/, '$1***@') });
    return res.json({ status: 'ok', message: '¡Te avisaremos cuando lancemos!' });
  }),
);

export default router;
