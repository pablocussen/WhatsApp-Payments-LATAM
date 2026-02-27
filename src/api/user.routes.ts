import { Router, Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest, generateToken } from '../middleware/jwt.middleware';
import { UserService } from '../services/user.service';
import { WalletService } from '../services/wallet.service';
import { TransactionService } from '../services/transaction.service';
import { createLogger } from '../config/logger';
import { asyncHandler } from '../utils/async-handler';

const router = Router();
const users = new UserService();
const wallets = new WalletService();
const transactions = new TransactionService();
const log = createLogger('user-api');

// ─── Schemas ────────────────────────────────────────────

const loginSchema = z.object({
  waId: z.string().min(10).max(15),
  pin: z.string().length(6),
});

const registerSchema = z.object({
  waId: z.string().min(10).max(15),
  rut: z.string().min(8).max(12),
  pin: z.string().length(6),
  name: z.string().max(100).optional(),
});

// ─── Auth ───────────────────────────────────────────────

// Login (PIN verification → JWT)
router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.' });
    }

    const { waId, pin } = parsed.data;
    const user = await users.getUserByWaId(waId);

    if (!user) {
      return res.status(401).json({ error: 'Usuario no encontrado.' });
    }

    const pinResult = await users.verifyUserPin(waId, pin);
    if (!pinResult.success) {
      return res.status(401).json({ error: pinResult.message });
    }

    const token = generateToken({
      userId: user.id,
      waId: user.waId,
      kycLevel: user.kycLevel,
    });

    return res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        kycLevel: user.kycLevel,
      },
    });
  }),
);

// Register new user
router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Datos inválidos.', details: parsed.error.flatten() });
    }

    const result = await users.createUser(parsed.data);

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    const user = await users.getUserByWaId(parsed.data.waId);
    const token = generateToken({
      userId: result.userId!,
      waId: parsed.data.waId,
      kycLevel: 'BASIC',
    });

    log.info('User registered via API', { userId: result.userId });

    return res.status(201).json({
      token,
      user: {
        id: result.userId,
        name: user?.name,
        kycLevel: 'BASIC',
      },
    });
  }),
);

// ─── Profile ────────────────────────────────────────────

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const user = await users.getUserById(req.user!.userId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const balance = await wallets.getBalance(req.user!.userId);
    const stats = await transactions.getTransactionStats(req.user!.userId);

    return res.json({
      ...user,
      balance,
      stats,
    });
  }),
);

export default router;
