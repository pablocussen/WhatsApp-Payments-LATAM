import { Router, Response } from 'express';
import { z } from 'zod';
import { requireAuth, AuthenticatedRequest } from '../middleware/jwt.middleware';
import { PaymentLinkService } from '../services/payment-link.service';
import { TransactionService } from '../services/transaction.service';
import { WalletService } from '../services/wallet.service';
const router = Router();
const paymentLinks = new PaymentLinkService();
const transactions = new TransactionService();
const wallets = new WalletService();

// ─── Schemas ────────────────────────────────────────────

const createLinkSchema = z.object({
  amount: z.number().min(100).optional(),
  description: z.string().max(500).optional(),
  expiresInHours: z.number().min(1).max(720).optional(), // max 30 days
  maxUses: z.number().min(1).max(1000).optional(),
});

const processPaymentSchema = z.object({
  receiverId: z.string().uuid(),
  amount: z.number().min(100),
  paymentMethod: z.enum(['WALLET', 'WEBPAY_CREDIT', 'WEBPAY_DEBIT', 'KHIPU']),
  description: z.string().max(500).optional(),
  paymentLinkId: z.string().uuid().optional(),
});

// ─── Payment Links ──────────────────────────────────────

// Resolve payment link (public - no auth needed)
router.get('/links/:code', async (req, res) => {
  const link = await paymentLinks.resolveLink(req.params.code);

  if (!link) {
    return res.status(404).json({ error: 'Enlace inválido o expirado.' });
  }

  return res.json(link);
});

// Create payment link (auth required)
router.post('/links', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const parsed = createLinkSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Datos inválidos.', details: parsed.error.flatten() });
  }

  const link = await paymentLinks.createLink({
    merchantId: req.user!.userId,
    ...parsed.data,
  });

  return res.status(201).json(link);
});

// List my payment links
router.get('/links', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const links = await paymentLinks.getMerchantLinks(req.user!.userId);
  return res.json({ links });
});

// Deactivate a payment link
router.delete('/links/:id', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const success = await paymentLinks.deactivateLink(req.params.id, req.user!.userId);
  if (!success) {
    return res.status(404).json({ error: 'Enlace no encontrado.' });
  }
  return res.json({ message: 'Enlace desactivado.' });
});

// ─── Payments ───────────────────────────────────────────

// Process a payment
router.post('/pay', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const parsed = processPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Datos inválidos.', details: parsed.error.flatten() });
  }

  const result = await transactions.processP2PPayment({
    senderId: req.user!.userId,
    senderWaId: req.user!.waId,
    receiverId: parsed.data.receiverId,
    amount: parsed.data.amount,
    paymentMethod: parsed.data.paymentMethod,
    description: parsed.data.description,
    paymentLinkId: parsed.data.paymentLinkId,
    ip: req.ip,
  });

  if (!result.success) {
    const status = result.fraudBlocked ? 403 : 400;
    return res.status(status).json({ error: result.error });
  }

  return res.status(201).json(result);
});

// Transaction history
router.get('/history', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const history = await transactions.getTransactionHistory(req.user!.userId, limit);
  return res.json({ history });
});

// ─── Wallet ─────────────────────────────────────────────

// Get balance
router.get('/wallet/balance', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const balance = await wallets.getBalance(req.user!.userId);
  return res.json(balance);
});

export default router;
