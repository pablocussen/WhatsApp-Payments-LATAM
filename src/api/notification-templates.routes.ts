import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/async-handler';
import { env } from '../config/environment';
import { notificationTemplates as ntplSvc } from '../services/notification-templates.service';

const router = Router();

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_API_KEY) { res.status(503).json({ error: 'Admin API not configured.' }); return; }
  const key = req.headers['x-admin-key'] as string | undefined;
  if (!key || key !== env.ADMIN_API_KEY) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  next();
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  channel: z.enum(['whatsapp', 'sms', 'email', 'push']),
  category: z.enum(['payment', 'topup', 'refund', 'security', 'promotion', 'system', 'onboarding']),
  subject: z.string().trim().max(200).optional(),
  body: z.string().trim().min(1).max(4096),
  locale: z.string().trim().max(10).optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  body: z.string().trim().min(1).max(4096).optional(),
  subject: z.string().trim().max(200).optional(),
});

// ─── GET /admin/notification-templates ───────────────────

router.get(
  '/admin/notification-templates',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const channel = req.query.channel as string | undefined;
    const category = req.query.category as string | undefined;
    const templates = await ntplSvc.listTemplates({
      channel: channel as 'whatsapp' | 'sms' | 'email' | 'push' | undefined,
      category: category as 'payment' | 'topup' | 'refund' | 'security' | 'promotion' | 'system' | 'onboarding' | undefined,
    });
    return res.json({ templates, count: templates.length });
  }),
);

// ─── POST /admin/notification-templates ──────────────────

router.post(
  '/admin/notification-templates',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.', details: parsed.error.flatten() });
    }

    try {
      const template = await ntplSvc.createTemplate(parsed.data);
      return res.status(201).json({ template });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }),
);

// ─── GET /admin/notification-templates/:id ───────────────

router.get(
  '/admin/notification-templates/:id',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const template = await ntplSvc.getTemplate(req.params.id);
    if (!template) return res.status(404).json({ error: 'Template no encontrado.' });
    return res.json({ template });
  }),
);

// ─── POST /admin/notification-templates/:id/update ───────

router.post(
  '/admin/notification-templates/:id/update',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.' });
    }

    try {
      const template = await ntplSvc.updateTemplate(req.params.id, parsed.data);
      if (!template) return res.status(404).json({ error: 'Template no encontrado.' });
      return res.json({ template });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }),
);

// ─── DELETE /admin/notification-templates/:id ────────────

router.delete(
  '/admin/notification-templates/:id',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const deactivated = await ntplSvc.deactivateTemplate(req.params.id);
    if (!deactivated) return res.status(404).json({ error: 'Template no encontrado.' });
    return res.json({ message: 'Template desactivado.' });
  }),
);

// ─── POST /admin/notification-templates/:id/render ───────

router.post(
  '/admin/notification-templates/:id/render',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const variables = req.body?.variables as Record<string, string> | undefined;
    if (!variables || typeof variables !== 'object') {
      return res.status(400).json({ error: 'Se requiere un objeto variables.' });
    }

    try {
      const rendered = await ntplSvc.render(req.params.id, variables);
      if (!rendered) return res.status(404).json({ error: 'Template no encontrado o inactivo.' });
      return res.json({ rendered });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }),
);

export default router;
