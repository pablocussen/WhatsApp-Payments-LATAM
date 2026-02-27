import { Router, Request, Response } from 'express';
import { TransbankService } from '../services/transbank.service';
import { KhipuService } from '../services/khipu.service';
import { WalletService } from '../services/wallet.service';
import { WhatsAppService } from '../services/whatsapp.service';
import { requireAuth, AuthenticatedRequest } from '../middleware/jwt.middleware';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';
import { generateReference } from '../utils/crypto';
import { getRedis } from '../config/database';
import { env } from '../config/environment';
import { asyncHandler } from '../utils/async-handler';

const router = Router();
const transbank = new TransbankService();
const khipu = new KhipuService();
const wallets = new WalletService();
const whatsapp = new WhatsAppService();
const log = createLogger('topup-api');

const TOPUP_MAPPING_TTL = 3600; // 1 hora

// ─── Initiate Top-up with Transbank ─────────────────────

router.post(
  '/webpay',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
    const amount = parseInt(req.body.amount, 10);
    if (!amount || amount < 1000 || amount > 500000) {
      return res.status(400).json({ error: 'Monto entre $1.000 y $500.000 CLP.' });
    }

    const buyOrder = generateReference().replace('#', '');
    const returnUrl = `${env.APP_BASE_URL}/api/v1/topup/webpay/callback`;

    const transaction = await transbank.createTransaction(buyOrder, amount, returnUrl);

    // Guardar mapping buyOrder → {userId, waId, amount} para recuperarlo en el callback
    const redis = getRedis();
    await redis.set(
      `topup:webpay:${buyOrder}`,
      JSON.stringify({ userId: req.user!.userId, waId: req.user!.waId, amount }),
      { EX: TOPUP_MAPPING_TTL },
    );

    log.info('WebPay top-up initiated', { userId: req.user!.userId, amount, buyOrder });

    return res.json({
      redirectUrl: transaction.url,
      token: transaction.token,
      amount,
    });
  }),
);

// ─── Transbank Callback (user returns here) ─────────────

router.post('/webpay/callback', async (req: Request, res: Response) => {
  const token = req.body.token_ws || req.query.token_ws;

  if (!token) {
    return res.redirect(`${env.APP_BASE_URL}/topup/error?reason=no_token`);
  }

  try {
    const result = await transbank.confirmTransaction(token as string);

    if (result.status !== 'AUTHORIZED') {
      log.warn('WebPay top-up failed', { status: result.status });
      return res.redirect(`${env.APP_BASE_URL}/topup/error?reason=${result.status}`);
    }

    if (!result.buyOrder) {
      log.error('WebPay callback: missing buy_order in Transbank response');
      return res.redirect(`${env.APP_BASE_URL}/topup/error?reason=missing_buy_order`);
    }

    const redis = getRedis();
    const key = `topup:webpay:${result.buyOrder}`;
    const raw = await redis.get(key);

    if (!raw) {
      log.error('WebPay callback: no mapping found', { buyOrder: result.buyOrder });
      return res.redirect(`${env.APP_BASE_URL}/topup/error?reason=mapping_not_found`);
    }

    // Eliminar el mapping para evitar doble acreditación
    await redis.del(key);

    const mapping: { userId: string; waId: string; amount: number } = JSON.parse(raw);

    // Acreditar wallet
    await wallets.credit(
      mapping.userId,
      mapping.amount,
      `Recarga WebPay ${(token as string).slice(0, 8)}`,
    );

    log.info('WebPay top-up credited', {
      userId: mapping.userId,
      amount: mapping.amount,
      card: result.cardLast4,
    });

    // Notificar al usuario por WhatsApp
    try {
      await whatsapp.sendTextMessage(
        mapping.waId,
        `✅ Recarga exitosa\n────────────────────\n${formatCLP(mapping.amount)} acreditados\nMétodo: WebPay\n────────────────────\nTu saldo ha sido actualizado.`,
      );
    } catch {
      /* Notificación opcional */
    }

    return res.redirect(`${env.APP_BASE_URL}/topup/success?amount=${result.amount}`);
  } catch (err) {
    log.error('WebPay callback error', { error: (err as Error).message });
    return res.redirect(`${env.APP_BASE_URL}/topup/error?reason=processing_error`);
  }
});

// ─── Initiate Top-up with Khipu ─────────────────────────

router.post(
  '/khipu',
  requireAuth,
  asyncHandler(async (req: AuthenticatedRequest, res: Response) => {
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
      reference,
    );

    // Guardar mapping paymentId → {userId, waId, amount}
    const redis = getRedis();
    await redis.set(
      `topup:khipu:${payment.paymentId}`,
      JSON.stringify({ userId: req.user!.userId, waId: req.user!.waId, amount }),
      { EX: TOPUP_MAPPING_TTL },
    );

    log.info('Khipu top-up initiated', {
      userId: req.user!.userId,
      amount,
      paymentId: payment.paymentId,
    });

    return res.json({
      paymentUrl: payment.paymentUrl,
      paymentId: payment.paymentId,
      amount,
    });
  }),
);

// ─── Khipu Notification Webhook ─────────────────────────

router.post('/khipu/notify', async (req: Request, res: Response) => {
  const { notification_token, api_version } = req.body;

  if (!khipu.verifyNotification(notification_token, api_version)) {
    return res.status(400).json({ error: 'Invalid notification' });
  }

  // Responder 200 a Khipu inmediatamente para evitar reintentos
  res.json({ status: 'received' });

  try {
    // Verificar estado real con Khipu
    const status = await khipu.getPaymentStatus(notification_token);

    if (status.status !== 'done') return;

    // Recuperar mapping paymentId → userId
    const redis = getRedis();
    const key = `topup:khipu:${status.paymentId}`;
    const raw = await redis.get(key);

    if (!raw) {
      log.warn('Khipu notify: no mapping found', { paymentId: status.paymentId });
      return;
    }

    const mapping: { userId: string; waId: string; amount: number } = JSON.parse(raw);

    // Eliminar el mapping para evitar doble acreditación
    await redis.del(key);

    // Acreditar wallet
    await wallets.credit(mapping.userId, mapping.amount, `Recarga Khipu ${status.paymentId}`);

    log.info('Khipu top-up credited', {
      userId: mapping.userId,
      paymentId: status.paymentId,
      amount: mapping.amount,
    });

    // Notificar al usuario por WhatsApp
    try {
      await whatsapp.sendTextMessage(
        mapping.waId,
        `✅ Recarga exitosa\n────────────────────\n${formatCLP(mapping.amount)} acreditados\nMétodo: Khipu (transferencia)\nRef: ${status.paymentId}\n────────────────────\nTu saldo ha sido actualizado.`,
      );
    } catch {
      /* Notificación opcional */
    }
  } catch (err) {
    log.error('Khipu notify processing error', { error: (err as Error).message });
  }
});

export default router;
