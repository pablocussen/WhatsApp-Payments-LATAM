import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/jwt.middleware';
import { asyncHandler } from '../utils/async-handler';
import { notifications } from '../services/notification.service';

const router = Router();

// ─── GET /notifications ─────────────────────────────────
router.get(
  '/notifications',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const list = await notifications.getUserNotifications(req.user!.userId, limit);
    const unread = list.filter(n => !n.read).length;
    return res.json({ notifications: list, count: list.length, unread });
  }),
);

// ─── GET /notifications/unread ──────────────────────────
router.get(
  '/notifications/unread',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const count = await notifications.getUnreadCount(req.user!.userId);
    return res.json({ unread: count });
  }),
);

// ─── POST /notifications/:id/read ──────────────────────
router.post(
  '/notifications/:id/read',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const success = await notifications.markRead(req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Notificación no encontrada.' });
    }
    return res.json({ message: 'Marcada como leída.', id: req.params.id });
  }),
);

export default router;
