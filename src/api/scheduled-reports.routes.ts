import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/async-handler';
import { env } from '../config/environment';
import { scheduledReports as reportsSvc } from '../services/scheduled-reports.service';

const router = Router();

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_API_KEY) { res.status(503).json({ error: 'Admin API not configured.' }); return; }
  const key = req.headers['x-admin-key'] as string | undefined;
  if (!key || key !== env.ADMIN_API_KEY) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  next();
}

const createSchema = z.object({
  merchantId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(100),
  type: z.enum(['transactions', 'revenue', 'users', 'disputes', 'compliance']),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  format: z.enum(['csv', 'json', 'summary']).optional(),
  recipients: z.array(z.string().email()).min(1).max(10),
  filters: z.record(z.string()).optional(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  frequency: z.enum(['daily', 'weekly', 'monthly']).optional(),
  recipients: z.array(z.string().email()).min(1).max(10).optional(),
  active: z.boolean().optional(),
});

// ─── GET /admin/reports ─────────────────────────────────

router.get(
  '/admin/reports',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const merchantId = req.query.merchantId as string;
    if (!merchantId) return res.status(400).json({ error: 'merchantId requerido.' });
    const reports = await reportsSvc.getMerchantReports(merchantId);
    return res.json({ reports, count: reports.length });
  }),
);

// ─── POST /admin/reports ────────────────────────────────

router.post(
  '/admin/reports',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.', details: parsed.error.flatten() });
    }

    try {
      const report = await reportsSvc.createReport(parsed.data);
      return res.status(201).json({ report });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }),
);

// ─── GET /admin/reports/:id ─────────────────────────────

router.get(
  '/admin/reports/:id',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const report = await reportsSvc.getReport(req.params.id);
    if (!report) return res.status(404).json({ error: 'Reporte no encontrado.' });
    return res.json({ report });
  }),
);

// ─── POST /admin/reports/:id/update ─────────────────────

router.post(
  '/admin/reports/:id/update',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.' });
    }

    try {
      const report = await reportsSvc.updateReport(req.params.id, parsed.data);
      if (!report) return res.status(404).json({ error: 'Reporte no encontrado.' });
      return res.json({ report });
    } catch (err) {
      return res.status(400).json({ error: (err as Error).message });
    }
  }),
);

// ─── DELETE /admin/reports/:id ──────────────────────────

router.delete(
  '/admin/reports/:id',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const deleted = await reportsSvc.deleteReport(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Reporte no encontrado.' });
    return res.json({ message: 'Reporte eliminado.' });
  }),
);

// ─── GET /admin/reports/:id/executions ──────────────────

router.get(
  '/admin/reports/:id/executions',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const executions = await reportsSvc.getExecutions(req.params.id);
    return res.json({ executions, count: executions.length });
  }),
);

export default router;
