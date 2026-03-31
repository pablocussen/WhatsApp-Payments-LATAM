import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/async-handler';
import { env } from '../config/environment';
import { transactionExport } from '../services/transaction-export.service';

const router = Router();

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_API_KEY) { res.status(503).json({ error: 'Admin API not configured.' }); return; }
  const key = req.headers['x-admin-key'] as string | undefined;
  if (!key || key !== env.ADMIN_API_KEY) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  next();
}

// ─── Schemas ───────────────────────────────────────────

const createExportSchema = z.object({
  requestedBy: z.string().trim().min(1),
  format: z.enum(['csv', 'json', 'summary']),
  filters: z.object({
    userId: z.string().optional(),
    merchantId: z.string().optional(),
    status: z.string().optional(),
    type: z.string().optional(),
    dateFrom: z.string().optional(),
    dateTo: z.string().optional(),
    minAmount: z.number().optional(),
    maxAmount: z.number().optional(),
  }).optional(),
});

// ─── POST /admin/exports ───────────────────────────────

router.post(
  '/admin/exports',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = createExportSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.', details: parsed.error.flatten() });
    }
    const job = await transactionExport.createExportJob(parsed.data);
    return res.status(201).json({ job });
  }),
);

// ─── GET /admin/exports/columns ────────────────────────
// NOTE: must be before /admin/exports/:id to avoid "columns" matching as :id

router.get(
  '/admin/exports/columns',
  requireAdminKey,
  asyncHandler(async (_req: Request, res: Response) => {
    const columns = await transactionExport.getColumns();
    return res.json({ columns });
  }),
);

// ─── GET /admin/exports/user/:userId ───────────────────

router.get(
  '/admin/exports/user/:userId',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    const jobs = await transactionExport.getUserJobs(userId);
    return res.json({ jobs });
  }),
);

// ─── GET /admin/exports/:id ────────────────────────────

router.get(
  '/admin/exports/:id',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const job = await transactionExport.getExportJob(id);
    if (!job) {
      return res.status(404).json({ error: 'Export job not found.' });
    }
    return res.json({ job });
  }),
);

export default router;
