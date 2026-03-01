/**
 * Route tests for webhook.routes.ts — HMAC signature validation branch.
 * Separate file because WHATSAPP_APP_SECRET must be set at module-load time.
 * Covers: verifySignature with secret, Redis catch in isDuplicate.
 */

// ─── Mock variables ────────────────────────────────────────────────────────────

const mockVerifyWebhook = jest.fn();
const mockParseWebhookMessage = jest.fn();
const mockHandleMessage = jest.fn();
const mockRedisSet = jest.fn();

// ─── Module mocks (WHATSAPP_APP_SECRET is set here) ───────────────────────────

jest.mock('../../src/config/environment', () => ({
  env: {
    NODE_ENV: 'test',
    WHATSAPP_APP_SECRET: 'test-app-secret-32-chars-minimum!!',
    APP_BASE_URL: 'http://localhost:3000',
  },
}));

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    set: mockRedisSet,
  }),
  prisma: {},
}));

jest.mock('../../src/services/whatsapp.service', () => ({
  WhatsAppService: jest.fn().mockImplementation(() => ({
    verifyWebhook: mockVerifyWebhook,
    parseWebhookMessage: mockParseWebhookMessage,
  })),
}));

jest.mock('../../src/services/bot.service', () => ({
  BotService: jest.fn().mockImplementation(() => ({
    handleMessage: mockHandleMessage,
  })),
}));

import express from 'express';
import { createHmac } from 'crypto';
import router from '../../src/api/webhook.routes';
import { startTestServer, type TestClient } from './http-test-client';

const APP_SECRET = 'test-app-secret-32-chars-minimum!!';
const app = express().use(express.json()).use(router);

// ─── Helper: compute valid HMAC signature ─────────────────────────────────────

function makeSignature(body: object): string {
  const hex = createHmac('sha256', APP_SECRET).update(JSON.stringify(body)).digest('hex');
  return `sha256=${hex}`;
}

// ─── Server lifecycle ─────────────────────────────────────────────────────────

let client: TestClient;
beforeAll(async () => {
  client = await startTestServer(app);
});
afterAll(async () => {
  await client.close();
});

// ─── POST /webhook signature validation ──────────────────────────────────────

describe('POST /webhook — HMAC signature validation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 401 when X-Hub-Signature-256 header is missing', async () => {
    const body = { entry: [] };
    const res = await client.post('/webhook', { body });
    expect(res.status).toBe(401);
    expect((res.body as { error: string }).error).toMatch(/signature/i);
  });

  it('returns 401 when signature is wrong', async () => {
    const body = { entry: [] };
    const res = await client.post('/webhook', {
      body,
      headers: {
        'X-Hub-Signature-256':
          'sha256=badhash00000000000000000000000000000000000000000000000000000000',
      },
    });
    expect(res.status).toBe(401);
  });

  it('returns 200 when signature is correct', async () => {
    const body = { entry: [] };
    mockParseWebhookMessage.mockReturnValue(null);
    const sig = makeSignature(body);
    const res = await client.post('/webhook', {
      body,
      headers: { 'X-Hub-Signature-256': sig },
    });
    expect(res.status).toBe(200);
  });
});

// ─── isDuplicate — Redis fail-open ────────────────────────────────────────────

describe('POST /webhook — Redis failure in isDuplicate (fail-open)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('processes message even when Redis throws (fail-open)', async () => {
    const body = { entry: [] };
    const validMessage = {
      from: '56912345678',
      id: 'wamid-x',
      type: 'text',
      text: { body: '/saldo' },
    };
    mockParseWebhookMessage.mockReturnValue(validMessage);
    // Redis set throws — isDuplicate catches and returns false (fail-open)
    mockRedisSet.mockRejectedValue(new Error('Redis ECONNREFUSED'));
    mockHandleMessage.mockResolvedValue(undefined);

    const sig = makeSignature(body);
    const res = await client.post('/webhook', {
      body,
      headers: { 'X-Hub-Signature-256': sig },
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 100));
    // Message was still processed despite Redis failure
    expect(mockHandleMessage).toHaveBeenCalled();
  });
});
