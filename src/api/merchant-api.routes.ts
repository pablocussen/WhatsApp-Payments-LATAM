/**
 * Merchant API routes — authenticated via API key (X-Api-Key header).
 * These endpoints allow merchants to integrate programmatically
 * without going through the WhatsApp bot or JWT flow.
 */
import { Router, Response } from 'express';
import { requireApiKey, type MerchantApiRequest } from '../middleware/apikey.middleware';
import { TransactionService } from '../services/transaction.service';
import { PaymentLinkService } from '../services/payment-link.service';
import { asyncHandler } from '../utils/async-handler';
import { rateLimitAction } from '../middleware/auth.middleware';
import { idempotency } from '../middleware/idempotency.middleware';

const router = Router();
const transactions = new TransactionService();
const paymentLinks = new PaymentLinkService();

// ─── Merchant Info ─────────────────────────────────────

router.get(
  '/merchant-api/me',
  requireApiKey(),
  asyncHandler(async (req: MerchantApiRequest, res: Response) => {
    res.json({
      merchantId: req.merchantId,
      apiKey: {
        id: req.apiKey!.id,
        name: req.apiKey!.name,
        prefix: req.apiKey!.keyPrefix,
        permissions: req.apiKey!.permissions,
        lastUsedAt: req.apiKey!.lastUsedAt,
      },
    });
  }),
);

// ─── Transactions (read) ───────────────────────────────

router.get(
  '/merchant-api/transactions',
  requireApiKey('transactions:read'),
  asyncHandler(async (req: MerchantApiRequest, res: Response) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const history = await transactions.getTransactionHistory(req.merchantId!, limit);
    res.json({ transactions: history, merchantId: req.merchantId });
  }),
);

// ─── Payment Links ─────────────────────────────────────

router.get(
  '/merchant-api/links',
  requireApiKey('links:read'),
  asyncHandler(async (req: MerchantApiRequest, res: Response) => {
    const links = await paymentLinks.getMerchantLinks(req.merchantId!);
    res.json({ links, count: links.length, merchantId: req.merchantId });
  }),
);

router.post(
  '/merchant-api/links',
  requireApiKey('links:write'),
  rateLimitAction('link:create'),
  asyncHandler(async (req: MerchantApiRequest, res: Response) => {
    const { amount, description, expiresInHours, maxUses } = req.body;
    const link = await paymentLinks.createLink({
      merchantId: req.merchantId!,
      amount: amount ?? null,
      description: description ?? null,
      expiresInHours: expiresInHours ?? 24,
      maxUses: maxUses ?? null,
    });
    res.status(201).json(link);
  }),
);

router.delete(
  '/merchant-api/links/:id',
  requireApiKey('links:write'),
  asyncHandler(async (req: MerchantApiRequest, res: Response) => {
    const deactivated = await paymentLinks.deactivateLink(req.params.id, req.merchantId!);
    if (!deactivated) {
      return res.status(404).json({ error: 'Link no encontrado o no te pertenece.' });
    }
    res.json({ message: 'Link desactivado.', id: req.params.id });
  }),
);

// ─── Payment Processing ────────────────────────────────

router.post(
  '/merchant-api/charge',
  requireApiKey('payments:write'),
  rateLimitAction('payment:create'),
  idempotency(),
  asyncHandler(async (req: MerchantApiRequest, res: Response) => {
    const { payerId, amount, description, paymentLinkId } = req.body;

    if (!payerId || !amount) {
      return res.status(400).json({ error: 'payerId y amount son requeridos.' });
    }
    if (amount < 100 || amount > 2_000_000) {
      return res.status(400).json({ error: 'Monto debe ser entre $100 y $2.000.000.' });
    }

    const result = await transactions.processP2PPayment({
      senderId: payerId,
      senderWaId: '',
      receiverId: req.merchantId!,
      amount,
      paymentMethod: 'WALLET',
      description,
      paymentLinkId,
    });

    if (!result.success) {
      return res.status(400).json({ error: result.error });
    }

    res.status(201).json(result);
  }),
);

export default router;
