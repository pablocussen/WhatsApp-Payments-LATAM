import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/async-handler';
import { env } from '../config/environment';
import { merchantWebhook } from '../services/merchant-webhook.service';

const router = Router();

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_API_KEY) { res.status(503).json({ error: 'Admin API not configured.' }); return; }
  const key = req.headers['x-admin-key'] as string | undefined;
  if (!key || key !== env.ADMIN_API_KEY) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  next();
}

// ─── Schemas ────────────────────────────────────────────────

const webhookEventsEnum = z.enum([
  'payment.created', 'payment.completed', 'payment.failed',
  'refund.created', 'refund.completed',
  'settlement.created', 'settlement.completed',
  'kyc.approved', 'kyc.rejected',
  'dispute.opened', 'dispute.resolved',
]);

const registerWebhookSchema = z.object({
  merchantId: z.string().trim().min(1),
  url: z.string().url(),
  events: z.array(webhookEventsEnum).min(1),
  description: z.string().trim().max(500).optional(),
});

const updateWebhookSchema = z.object({
  url: z.string().url().optional(),
  events: z.array(webhookEventsEnum).min(1).optional(),
  description: z.string().trim().max(500).optional(),
  status: z.enum(['active', 'disabled', 'failing']).optional(),
});

// ─── POST /admin/merchant-webhooks ──────────────────────────
// Register a new webhook

router.post(
  '/admin/merchant-webhooks',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = registerWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.', details: parsed.error.flatten() });
    }
    try {
      const webhook = await merchantWebhook.registerWebhook(parsed.data);
      return res.status(201).json({ webhook });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }),
);

// ─── GET /admin/merchant-webhooks/merchant/:merchantId ──────
// List webhooks for a merchant

router.get(
  '/admin/merchant-webhooks/merchant/:merchantId',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const webhooks = await merchantWebhook.getMerchantWebhooks(req.params.merchantId);
    return res.json({ webhooks, count: webhooks.length });
  }),
);

// ─── GET /admin/merchant-webhooks/:id ───────────────────────
// Get webhook detail

router.get(
  '/admin/merchant-webhooks/:id',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const webhook = await merchantWebhook.getWebhook(req.params.id);
    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found.' });
    }
    return res.json({ webhook });
  }),
);

// ─── POST /admin/merchant-webhooks/:id/update ───────────────
// Update webhook configuration

router.post(
  '/admin/merchant-webhooks/:id/update',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = updateWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.', details: parsed.error.flatten() });
    }
    const webhook = await merchantWebhook.updateWebhook(req.params.id, parsed.data);
    if (!webhook) {
      return res.status(404).json({ error: 'Webhook not found.' });
    }
    return res.json({ webhook });
  }),
);

// ─── POST /admin/merchant-webhooks/:id/rotate-secret ────────
// Rotate signing secret

router.post(
  '/admin/merchant-webhooks/:id/rotate-secret',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const result = await merchantWebhook.rotateSecret(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Webhook not found.' });
    }
    return res.json(result);
  }),
);

// ─── DELETE /admin/merchant-webhooks/:id ────────────────────
// Soft-delete a webhook

router.delete(
  '/admin/merchant-webhooks/:id',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const deleted = await merchantWebhook.deleteWebhook(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: 'Webhook not found.' });
    }
    return res.json({ success: true });
  }),
);

// ─── GET /admin/merchant-webhooks/:id/deliveries ────────────
// List recent deliveries for a webhook

router.get(
  '/admin/merchant-webhooks/:id/deliveries',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const deliveries = await merchantWebhook.getDeliveries(req.params.id, limit);
    return res.json({ deliveries, count: deliveries.length });
  }),
);

// ─── GET /admin/merchant-webhooks/:id/stats ─────────────────
// Get delivery stats for a webhook

router.get(
  '/admin/merchant-webhooks/:id/stats',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const stats = await merchantWebhook.getDeliveryStats(req.params.id);
    return res.json({ stats });
  }),
);

export default router;
