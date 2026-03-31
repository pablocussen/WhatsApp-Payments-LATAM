import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { env } from '../config/environment';
import { createLogger } from '../config/logger';
import { asyncHandler } from '../utils/async-handler';
import { webhookEvents } from '../services/webhook-events.service';

const log = createLogger('webhook-events-routes');
const router = Router();

// ─── Admin API Key Middleware ────────────────────────────

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_API_KEY) {
    res.status(503).json({ error: 'Admin API not configured.' });
    return;
  }

  const key = req.headers['x-admin-key'] as string | undefined;
  if (!key || key !== env.ADMIN_API_KEY) {
    log.warn('Admin auth failed', { ip: req.ip });
    res.status(401).json({ error: 'Invalid admin key.' });
    return;
  }

  next();
}

router.use('/admin/webhook-subscriptions', requireAdminKey);

// ─── Schemas ────────────────────────────────────────────

const subscribeSchema = z.object({
  url: z.string().url(),
  events: z.array(
    z.enum([
      'payment.completed',
      'payment.failed',
      'payment.refunded',
      'topup.completed',
      'user.created',
      'user.kyc_upgraded',
    ]),
  ),
});

// ─── POST /admin/webhook-subscriptions ──────────────────

router.post(
  '/admin/webhook-subscriptions',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request.', details: parsed.error.issues });
    }

    const sub = await webhookEvents.subscribe(parsed.data.url, parsed.data.events);
    return res.status(201).json(sub);
  }),
);

// ─── GET /admin/webhook-subscriptions ───────────────────

router.get(
  '/admin/webhook-subscriptions',
  asyncHandler(async (_req: Request, res: Response) => {
    const subscriptions = await webhookEvents.getSubscriptions();
    return res.json({ subscriptions, count: subscriptions.length });
  }),
);

// ─── DELETE /admin/webhook-subscriptions/:id ────────────

router.delete(
  '/admin/webhook-subscriptions/:id',
  asyncHandler(async (req: Request, res: Response) => {
    const removed = await webhookEvents.unsubscribe(req.params.id);
    if (!removed) {
      return res.status(404).json({ error: 'Subscription not found.' });
    }
    return res.json({ message: 'Subscription removed.' });
  }),
);

export default router;
