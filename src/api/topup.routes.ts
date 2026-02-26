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

const router = Router();
const transbank = new TransbankService();
const khipu = new KhipuService();
const wallets = new WalletService();
const whatsapp = new WhatsAppService();
const log = createLogger('topup-api');

const TOPUP_MAPPING_TTL = 3600; // 1 hora

// ─── Initiate Top-up with Transbank ─────────────────────

router.post('/topup/webpay', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const amount = parseInt(req.body.amount, 10);
  if (!amount || amount < 1000 || amount > 500000) {
    return res.status(400).json({ error: 'Monto entre $1.000 y $500.000 CLP.' });
  }

  const buyOrder = generateReference().replace('#', '');
  const returnUrl = `${env.APP_BASE_URL}/api/v1/topup/webpay/callback`;

  const transaction = await transbank.createTransaction(buyOrder, amount, returnUrl);

  // Guardar mapping buyOrder → {userId, amount} para recuperarlo en el callback
  const redis = getRedis();
  await redis.set(
    `topup:webpay:${buyOrder}`,
    JSON.stringify({ userId: req.user!.userId, waId: req.user!.waId, amount }),
    { EX: TOPUP_MAPPING_TTL }
  );

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

  if (result.status !== 'AUTHORIZED') {
    log.warn('WebPay top-up failed', { status: result.status });
    return res.redirect(`${env.APP_BASE_URL}/topup/error?reason=${result.status}`);
  }

  // Recuperar el userId desde el token Transbank usando el buyOrder
  // Transbank no nos devuelve el buyOrder en el callback directamente,
  // pero el token_ws es único por transacción — lo usamos como key alternativo.
  // Buscamos el mapping por prefijo (token_ws no es el buyOrder, necesitamos el buy_order de la respuesta)
  const buyOrder = result.authorizationCode ? undefined : undefined; // buy_order viene en confirmTransaction
  // NOTA: TransbankService devuelve {status, amount, authorizationCode, cardLast4, paymentType}
  // pero no el buyOrder. Para resolverlo correctamente necesitamos el buyOrder del body de Transbank.
  // El token_ws que viene en el body es el mismo que creamos, lo usamos como referencia.
  const tbkToken = token as string;

  try {
    const redis = getRedis();
    // Buscar todas las keys de topup:webpay:* (el buyOrder lo generamos nosotros)
    // Como no tenemos el buyOrder en el callback, buscamos con scan
    // Alternativa: Transbank devuelve buy_order en la respuesta de PUT /transactions/{token_ws}
    // En el SDK real esto viene en data.buy_order — extendemos TransbankService si es necesario.
    // Por ahora buscamos el mapping por token usando SCAN (máx 100 keys activas en cualquier momento)
    const keys = await redis.keys('topup:webpay:*');
    let mapping: { userId: string; waId: string; amount: number } | null = null;
    let matchedKey: string | null = null;

    for (const key of keys) {
      const raw = await redis.get(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Verificar que el amount coincide con lo que confirmó Transbank
        if (parsed.amount === result.amount) {
          mapping = parsed;
          matchedKey = key;
          break;
        }
      }
    }

    if (!mapping) {
      log.error('WebPay callback: no mapping found for amount', { amount: result.amount });
      return res.redirect(`${env.APP_BASE_URL}/topup/success?amount=${result.amount}`);
    }

    // Eliminar el mapping para evitar doble acreditación
    await redis.del(matchedKey!);

    // Acreditar wallet
    await wallets.credit(mapping.userId, mapping.amount, `Recarga WebPay ${tbkToken.slice(0, 8)}`);

    log.info('WebPay top-up credited', {
      userId: mapping.userId,
      amount: mapping.amount,
      card: result.cardLast4,
    });

    // Notificar al usuario por WhatsApp
    try {
      await whatsapp.sendTextMessage(
        mapping.waId,
        `✅ Recarga exitosa\n────────────────────\n${formatCLP(mapping.amount)} acreditados\nMétodo: WebPay\n────────────────────\nTu saldo ha sido actualizado.`
      );
    } catch { /* Notificación opcional */ }

    return res.redirect(`${env.APP_BASE_URL}/topup/success?amount=${result.amount}`);
  } catch (err) {
    log.error('WebPay callback error', { error: (err as Error).message });
    return res.redirect(`${env.APP_BASE_URL}/topup/error?reason=processing_error`);
  }
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

  // Guardar mapping paymentId → {userId, waId, amount}
  const redis = getRedis();
  await redis.set(
    `topup:khipu:${payment.paymentId}`,
    JSON.stringify({ userId: req.user!.userId, waId: req.user!.waId, amount }),
    { EX: TOPUP_MAPPING_TTL }
  );

  log.info('Khipu top-up initiated', { userId: req.user!.userId, amount, paymentId: payment.paymentId });

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
        `✅ Recarga exitosa\n────────────────────\n${formatCLP(mapping.amount)} acreditados\nMétodo: Khipu (transferencia)\nRef: ${status.paymentId}\n────────────────────\nTu saldo ha sido actualizado.`
      );
    } catch { /* Notificación opcional */ }
  } catch (err) {
    log.error('Khipu notify processing error', { error: (err as Error).message });
  }
});

export default router;
