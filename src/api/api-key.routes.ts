import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/async-handler';
import { env } from '../config/environment';
import { apiKeys } from '../services/api-key.service';

const router = Router();

function requireAdminKey(req: Request, res: Response, next: NextFunction): void {
  if (!env.ADMIN_API_KEY) { res.status(503).json({ error: 'Admin API not configured.' }); return; }
  const key = req.headers['x-admin-key'] as string | undefined;
  if (!key || key !== env.ADMIN_API_KEY) { res.status(401).json({ error: 'Unauthorized.' }); return; }
  next();
}

// ─── Schemas ────────────────────────────────────────────

const createKeySchema = z.object({
  merchantId: z.string().trim().min(1),
  name: z.string().trim().min(1).max(50),
  permissions: z.array(
    z.enum(['payments:read', 'payments:write', 'links:read', 'links:write', 'transactions:read', 'webhooks:manage']),
  ),
});

// ─── POST /admin/api-keys ──────────────────────────────

router.post(
  '/admin/api-keys',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = createKeySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.', details: parsed.error.flatten() });
    }

    try {
      const key = await apiKeys.createKey(parsed.data.merchantId, parsed.data.name, parsed.data.permissions);
      return res.status(201).json({ key });
    } catch (err) {
      return res.status(409).json({ error: (err as Error).message });
    }
  }),
);

// ─── GET /admin/api-keys/merchant/:merchantId ──────────

router.get(
  '/admin/api-keys/merchant/:merchantId',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const keys = await apiKeys.getKeys(req.params.merchantId);
    return res.json({ keys, count: keys.length });
  }),
);

// ─── DELETE /admin/api-keys/:keyId ─────────────────────

router.delete(
  '/admin/api-keys/:keyId',
  requireAdminKey,
  asyncHandler(async (req: Request, res: Response) => {
    const merchantId = req.query.merchantId as string | undefined;
    if (!merchantId) {
      return res.status(400).json({ error: 'merchantId requerido.' });
    }
    const revoked = await apiKeys.revokeKey(merchantId, req.params.keyId);
    if (!revoked) {
      return res.status(404).json({ error: 'API key no encontrada.' });
    }
    return res.json({ deleted: true });
  }),
);

export default router;
