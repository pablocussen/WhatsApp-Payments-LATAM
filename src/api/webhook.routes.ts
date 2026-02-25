import { Router, Request, Response } from 'express';
import { WhatsAppService } from '../services/whatsapp.service';
import { BotService } from '../services/bot.service';
import { createLogger } from '../config/logger';

const router = Router();
const whatsapp = new WhatsAppService();
const bot = new BotService();
const log = createLogger('webhook');

const DEDUP_TTL = 300; // 5 minutes

async function isDuplicate(messageId: string): Promise<boolean> {
  try {
    const { getRedis } = await import('../config/database');
    const redis = getRedis();
    const key = `wa:msg:${messageId}`;
    const wasSet = await redis.set(key, '1', { NX: true, EX: DEDUP_TTL });
    return wasSet === null; // null = key already existed = duplicate
  } catch {
    return false; // Redis down → process anyway (fail-open)
  }
}

// ─── WhatsApp Webhook Verification (GET) ────────────────

router.get('/webhook', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'] as string;
  const token = req.query['hub.verify_token'] as string;
  const challenge = req.query['hub.challenge'] as string;

  const result = whatsapp.verifyWebhook(mode, token, challenge);

  if (result) {
    log.info('Webhook verified');
    return res.status(200).send(result);
  }

  log.warn('Webhook verification failed');
  return res.status(403).json({ error: 'Verification failed' });
});

// ─── WhatsApp Webhook Messages (POST) ───────────────────

router.post('/webhook', async (req: Request, res: Response) => {
  // Always respond 200 immediately (WhatsApp requirement)
  res.status(200).json({ status: 'received' });

  try {
    const message = whatsapp.parseWebhookMessage(req.body);
    if (!message) return;

    // Idempotency: skip already-processed messages
    if (message.id && await isDuplicate(message.id)) {
      log.debug('Duplicate message skipped', { messageId: message.id, from: message.from });
      return;
    }

    log.debug('Message received', { from: message.from, type: message.type });

    const text = message.text?.body?.trim() || '';
    const buttonId = message.interactive?.button_reply?.id;
    const listId = message.interactive?.list_reply?.id;
    const input = buttonId || listId || text;

    await bot.handleMessage(message.from, input, buttonId || listId);
  } catch (error) {
    log.error('Webhook processing error', { error: (error as Error).message });
  }
});

export default router;
