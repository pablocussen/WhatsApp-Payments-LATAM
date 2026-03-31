import { Router } from 'express';
import type { Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/jwt.middleware';
import { asyncHandler } from '../utils/async-handler';
import { contacts } from '../services/contacts.service';

const router = Router();

// ─── Schemas ────────────────────────────────────────────

const addContactSchema = z.object({
  userId: z.string(),
  waId: z.string().regex(/^\+?\d{8,15}$/),
  name: z.string().max(50),
  alias: z.string().max(20).optional(),
});

// ─── GET /contacts ──────────────────────────────────────

router.get(
  '/contacts',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const list = await contacts.getContacts(req.user!.userId);
    return res.json({ contacts: list, count: list.length });
  }),
);

// ─── POST /contacts ─────────────────────────────────────

router.post(
  '/contacts',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const parsed = addContactSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.', details: parsed.error.flatten() });
    }

    const result = await contacts.addContact(req.user!.userId, parsed.data);

    if (!result.success) {
      return res.status(409).json({ error: result.message });
    }

    return res.status(201).json({ message: result.message });
  }),
);

// ─── DELETE /contacts/:contactUserId ────────────────────

router.delete(
  '/contacts/:contactUserId',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const removed = await contacts.removeContact(req.user!.userId, req.params.contactUserId);

    if (!removed) {
      return res.status(404).json({ error: 'Contacto no encontrado.' });
    }

    return res.json({ deleted: true });
  }),
);

// ─── GET /contacts/search ───────────────────────────────

router.get(
  '/contacts/search',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const phone = req.query.phone as string | undefined;

    if (!phone) {
      return res.status(400).json({ error: 'Parámetro phone requerido.' });
    }

    const result = await contacts.findByPhone(req.user!.userId, phone);
    return res.json({ contact: result ?? null });
  }),
);

export default router;
