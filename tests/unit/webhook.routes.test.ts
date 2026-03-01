/**
 * Route-level tests for webhook.routes.ts.
 * Covers: GET /webhook (verification), POST /webhook (signature, dedup, bot handling).
 * WhatsApp signature check is skipped when WHATSAPP_APP_SECRET is not set.
 */

// ─── Mock variables ────────────────────────────────────────────────────────────

const mockVerifyWebhook = jest.fn();
const mockParseWebhookMessage = jest.fn();
const mockHandleMessage = jest.fn();
const mockRedisSet = jest.fn();

// ─── Module mocks ─────────────────────────────────────────────────────────────

jest.mock('../../src/config/environment', () => ({
  env: {
    NODE_ENV: 'test',
    WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
    WHATSAPP_APP_SECRET: undefined, // No signature validation in tests
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
import router from '../../src/api/webhook.routes';
import { startTestServer, type TestClient } from './http-test-client';

const app = express().use(express.json()).use(router);

// ─── Server lifecycle ─────────────────────────────────────────────────────────

let client: TestClient;
beforeAll(async () => {
  client = await startTestServer(app);
});
afterAll(async () => {
  await client.close();
});

// ─── GET /webhook (verification) ─────────────────────────────────────────────

describe('GET /webhook', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 and echoes challenge when verification succeeds', async () => {
    mockVerifyWebhook.mockReturnValue('challenge-abc123');
    const res = await client.get(
      '/webhook?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=challenge-abc123',
    );
    expect(res.status).toBe(200);
    expect(res.body).toBe('challenge-abc123');
  });

  it('returns 403 when verification fails (wrong token)', async () => {
    mockVerifyWebhook.mockReturnValue(null);
    const res = await client.get(
      '/webhook?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=challenge-abc',
    );
    expect(res.status).toBe(403);
  });
});

// ─── POST /webhook (message handling) ────────────────────────────────────────

describe('POST /webhook', () => {
  const validMessage = {
    from: '56912345678',
    id: 'wamid-001',
    type: 'text',
    text: { body: '/saldo' },
  };

  beforeEach(() => jest.clearAllMocks());

  it('responds 200 immediately (WhatsApp requirement)', async () => {
    mockParseWebhookMessage.mockReturnValue(null);
    const res = await client.post('/webhook', {
      body: { entry: [] },
    });
    expect(res.status).toBe(200);
    expect((res.body as { status: string }).status).toBe('received');
  });

  it('returns 200 and processes a valid text message', async () => {
    mockParseWebhookMessage.mockReturnValue(validMessage);
    mockRedisSet.mockResolvedValue('OK'); // not a duplicate (first time)
    mockHandleMessage.mockResolvedValue(undefined);

    const webhookBody = {
      entry: [{ changes: [{ value: { messages: [validMessage] } }] }],
    };
    const res = await client.post('/webhook', { body: webhookBody });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(mockHandleMessage).toHaveBeenCalledWith('56912345678', '/saldo', undefined);
  });

  it('skips duplicate messages (Redis already has the key)', async () => {
    mockParseWebhookMessage.mockReturnValue(validMessage);
    mockRedisSet.mockResolvedValue(null); // null = duplicate (NX flag: key already exists)

    const res = await client.post('/webhook', {
      body: { entry: [{ changes: [{ value: { messages: [{}] } }] }] },
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(mockHandleMessage).not.toHaveBeenCalled();
  });

  it('skips processing when message is null (e.g. status updates)', async () => {
    mockParseWebhookMessage.mockReturnValue(null);

    const res = await client.post('/webhook', {
      body: { entry: [{ changes: [{ value: { statuses: [{ status: 'delivered' }] } }] }] },
    });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(mockHandleMessage).not.toHaveBeenCalled();
  });

  it('handles button replies by passing buttonId as third argument', async () => {
    const buttonMsg = {
      from: '56912345678',
      id: 'wamid-btn',
      type: 'interactive',
      interactive: { type: 'button_reply', button_reply: { id: 'confirm_pay', title: 'Sí' } },
    };
    mockParseWebhookMessage.mockReturnValue(buttonMsg);
    mockRedisSet.mockResolvedValue('OK');
    mockHandleMessage.mockResolvedValue(undefined);

    const res = await client.post('/webhook', { body: {} });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(mockHandleMessage).toHaveBeenCalledWith('56912345678', 'confirm_pay', 'confirm_pay');
  });

  it('handles bot errors without crashing (error is caught internally)', async () => {
    mockParseWebhookMessage.mockReturnValue(validMessage);
    mockRedisSet.mockResolvedValue('OK');
    mockHandleMessage.mockRejectedValue(new Error('Bot crashed'));

    const res = await client.post('/webhook', { body: {} });
    // 200 already sent before async processing
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    // Test completes without throwing — error is swallowed
  });

  it('processes message without id (no dedup check)', async () => {
    const noIdMessage = { from: '56912345678', type: 'text', text: { body: '/ayuda' } };
    mockParseWebhookMessage.mockReturnValue(noIdMessage);
    mockHandleMessage.mockResolvedValue(undefined);

    const res = await client.post('/webhook', { body: {} });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    // With no id, isDuplicate check is skipped and message is processed
    expect(mockHandleMessage).toHaveBeenCalledWith('56912345678', '/ayuda', undefined);
    // Redis set should NOT have been called (no messageId)
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('handles list_reply interactive messages (covers list_reply?.id branch)', async () => {
    const listMsg = {
      from: '56912345678',
      id: 'wamid-list',
      type: 'interactive',
      interactive: { type: 'list_reply', list_reply: { id: 'menu_option_1', title: 'Opción 1' } },
    };
    mockParseWebhookMessage.mockReturnValue(listMsg);
    mockRedisSet.mockResolvedValue('OK');
    mockHandleMessage.mockResolvedValue(undefined);

    const res = await client.post('/webhook', { body: {} });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50));
    expect(mockHandleMessage).toHaveBeenCalledWith('56912345678', 'menu_option_1', 'menu_option_1');
  });
});
