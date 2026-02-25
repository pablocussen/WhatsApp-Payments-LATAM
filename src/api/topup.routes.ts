import { Router, Request, Response } from 'express';
import { TransbankService } from '../services/transbank.service';
import { KhipuService } from '../services/khipu.service';
import { WalletService } from '../services/wallet.service';
import { WhatsAppService } from '../services/whatsapp.service';
import { requireAuth, AuthenticatedRequest } from '../middleware/jwt.middleware';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';
import { generateReference } from '../utils/crypto';
import { env } from '../config/environment';

const router = Router();
const transbank = new TransbankService();
const khipu = new KhipuService();
const wallets = new WalletService();
const whatsapp = new WhatsAppService();
const log = createLogger('topup-api');

// ─── Initiate Top-up with Transbank ─────────────────────

router.post('/topup/webpay', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const amount = parseInt(req.body.amount, 10);
  if (!amount || amount < 1000 || amount > 500000) {
    return res.status(400).json({ error: 'Monto entre $1.000 y $500.000 CLP.' });
  }

  const buyOrder = generateReference().replace('#', '');
  const returnUrl = `${env.APP_BASE_URL}/api/v1/topup/webpay/callback`;

  const transaction = await transbank.createTransaction(buyOrder, amount, returnUrl);

  log.info('WebPay top-up initiated', { userId: req.user!.userId, amount, buyOrder });

  return res.json({
    redirectUrl: transaction.url,
    token: transaction.token,
    amount,
  });
});

// ─── Transbank Callback (user returns here) ─────────────

router.post('/topup/webpay/callback', async (req: Request, res: Response) => {
  const token = req.body.token_ws || req.query.token_ws;

  if (!token) {
    return res.redirect(`${env.APP_BASE_URL}/topup/error?reason=no_token`);
  }

  const result = await transbank.confirmTransaction(token as string);

  if (result.status === 'AUTHORIZED') {
    // TODO: Look up which user initiated this transaction (from stored token mapping)
    // For now, this is a simplified flow
    log.info('WebPay top-up confirmed', {
      amount: result.amount,
      card: result.cardLast4,
    });

    return res.redirect(`${env.APP_BASE_URL}/topup/success?amount=${result.amount}`);
  }

  log.warn('WebPay top-up failed', { status: result.status });
  return res.redirect(`${env.APP_BASE_URL}/topup/error?reason=${result.status}`);
});

// ─── Initiate Top-up with Khipu ─────────────────────────

router.post('/topup/khipu', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const amount = parseInt(req.body.amount, 10);
  if (!amount || amount < 1000 || amount > 500000) {
    return res.status(400).json({ error: 'Monto entre $1.000 y $500.000 CLP.' });
  }

  const reference = generateReference();
  const notifyUrl = `${env.APP_BASE_URL}/api/v1/topup/khipu/notify`;
  const returnUrl = `${env.APP_BASE_URL}/topup/success`;

  const payment = await khipu.createPayment(
    `Recarga WhatPay ${formatCLP(amount)}`,
    amount,
    notifyUrl,
    returnUrl,
    reference
  );

  log.info('Khipu top-up initiated', { userId: req.user!.userId, amount, reference });

  return res.json({
    paymentUrl: payment.paymentUrl,
    paymentId: payment.paymentId,
    amount,
  });
});

// ─── Khipu Notification Webhook ─────────────────────────

router.post('/topup/khipu/notify', async (req: Request, res: Response) => {
  const { notification_token, api_version } = req.body;

  if (!khipu.verifyNotification(notification_token, api_version)) {
    return res.status(400).json({ error: 'Invalid notification' });
  }

  // Verify payment with Khipu
  const status = await khipu.getPaymentStatus(notification_token);

  if (status.status === 'done') {
    log.info('Khipu payment confirmed', {
      paymentId: status.paymentId,
      amount: status.amount,
    });

    // TODO: Credit the user's wallet based on transaction_id mapping
    // await wallets.credit(userId, status.amount, `Recarga Khipu ${status.paymentId}`);
  }

  return res.json({ status: 'received' });
});

export default router;
