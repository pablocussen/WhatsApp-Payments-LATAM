import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { env } from '../config/environment';
import { createLogger } from '../config/logger';
import { asyncHandler } from '../utils/async-handler';
import { rateLimiter } from '../services/rate-limit.service';

const log = createLogger('rate-limit-routes');
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

router.use('/admin/rate-limits', requireAdminKey);

// ─── Schemas ────────────────────────────────────────────

const identifierSchema = z.object({
  identifier: z.string().min(1),
});

const overrideSchema = z.object({
  maxRequests: z.number().int().min(1),
  windowSeconds: z.number().int().min(1),
});

// ─── GET /admin/rate-limits ─────────────────────────────

router.get(
  '/admin/rate-limits',
  asyncHandler(async (_req: Request, res: Response) => {
    const limits = rateLimiter.getAllLimits();
    return res.json({ limits });
  }),
);

// ─── POST /admin/rate-limits/:action/check ──────────────

router.post(
  '/admin/rate-limits/:action/check',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = identifierSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request.', details: parsed.error.issues });
    }

    const result = await rateLimiter.check(req.params.action, parsed.data.identifier);
    return res.json({ result });
  }),
);

// ─── POST /admin/rate-limits/:action/reset ──────────────

router.post(
  '/admin/rate-limits/:action/reset',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = identifierSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request.', details: parsed.error.issues });
    }

    await rateLimiter.reset(req.params.action, parsed.data.identifier);
    return res.json({ message: `Rate limit reset for ${req.params.action}.` });
  }),
);

// ─── POST /admin/rate-limits/:action/override ───────────

router.post(
  '/admin/rate-limits/:action/override',
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = overrideSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid request.', details: parsed.error.issues });
    }

    rateLimiter.setLimit(req.params.action, parsed.data);
    return res.json({ message: `Override set for ${req.params.action}.` });
  }),
);

// ─── DELETE /admin/rate-limits/:action/override ─────────

router.delete(
  '/admin/rate-limits/:action/override',
  asyncHandler(async (req: Request, res: Response) => {
    rateLimiter.removeOverride(req.params.action);
    return res.json({ message: `Override removed for ${req.params.action}.` });
  }),
);

export default router;
