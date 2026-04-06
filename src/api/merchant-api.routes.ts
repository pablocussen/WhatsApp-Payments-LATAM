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
import { merchantStats } from '../services/merchant-stats.service';
import { generateCsv, TRANSACTION_COLUMNS } from '../utils/csv-export';

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

// ─── Dashboard Stats ───────────────────────────────────

router.get(
  '/merchant-api/stats',
  requireApiKey('transactions:read'),
  asyncHandler(async (req: MerchantApiRequest, res: Response) => {
    const stats = await merchantStats.getDashboardStats(req.merchantId!);
    res.json({ merchantId: req.merchantId, stats });
  }),
);

// ─── CSV Export ────────────────────────────────────────

router.get(
  '/merchant-api/export/csv',
  requireApiKey('transactions:read'),
  asyncHandler(async (req: MerchantApiRequest, res: Response) => {
    const limit = Math.min(Number(req.query.limit) || 100, 1000);
    const history = await transactions.getTransactionHistory(req.merchantId!, limit);

    // Parse the formatted text history into CSV-friendly rows
    // For now, return a simple CSV with the raw data
    const rows = [{
      reference: 'Export generado',
      date: new Date().toISOString(),
      type: 'info',
      amount: 0,
      fee: 0,
      net: 0,
      status: 'N/A',
      counterparty: req.merchantId,
      description: `Historial: ${history.slice(0, 50)}...`,
      paymentMethod: 'N/A',
    }];

    const csv = generateCsv(rows, TRANSACTION_COLUMNS);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=whatpay-export-${new Date().toISOString().slice(0, 10)}.csv`);
    return res.send(csv);
  }),
);

// ─── Webhook Test ──────────────────────────────────────
// Send a test webhook event to verify merchant's endpoint

router.post(
  '/merchant-api/webhooks/test',
  requireApiKey('webhooks:manage'),
  asyncHandler(async (req: MerchantApiRequest, res: Response) => {
    const { url, event } = req.body;

    if (!url || !event) {
      return res.status(400).json({ error: 'url y event son requeridos.' });
    }

    const testPayload = {
      event: event || 'payment.completed',
      timestamp: new Date().toISOString(),
      test: true,
      data: {
        transactionId: 'test_' + Date.now().toString(36),
        reference: '#WP-TEST-WEBHOOK',
        amount: 1000,
        merchantId: req.merchantId,
        message: 'Este es un evento de prueba. No representa una transaccion real.',
      },
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-WhatPay-Event': event,
          'X-WhatPay-Test': 'true',
          'User-Agent': 'WhatPay-Webhook/1.0',
        },
        body: JSON.stringify(testPayload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      return res.json({
        success: response.status >= 200 && response.status < 300,
        statusCode: response.status,
        url,
        event,
        payload: testPayload,
      });
    } catch (err) {
      return res.json({
        success: false,
        error: (err as Error).message,
        url,
        event,
        payload: testPayload,
      });
    }
  }),
);

export default router;
