/**
 * Unit tests for WhatsAppService.
 * global.fetch is mocked so no real HTTP calls are made.
 */

const mockRedisRPush = jest.fn().mockResolvedValue(1);
const mockRedisLRange = jest.fn().mockResolvedValue([]);
const mockRedisLLen = jest.fn().mockResolvedValue(0);
const mockRedisDEL = jest.fn().mockResolvedValue(1);
const mockRedisLIndex = jest.fn().mockResolvedValue(null);
const mockRedisLSet = jest.fn().mockResolvedValue('OK');
const mockRedisLRem = jest.fn().mockResolvedValue(1);

jest.mock('../../src/config/environment', () => ({
  env: {
    WHATSAPP_API_URL: 'https://graph.facebook.com/v18.0',
    WHATSAPP_PHONE_NUMBER_ID: 'test-phone-id',
    WHATSAPP_API_TOKEN: 'test-token',
    WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
  },
}));

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    rPush: (...args: unknown[]) => mockRedisRPush(...args),
    lRange: (...args: unknown[]) => mockRedisLRange(...args),
    lLen: (...args: unknown[]) => mockRedisLLen(...args),
    del: (...args: unknown[]) => mockRedisDEL(...args),
    lIndex: (...args: unknown[]) => mockRedisLIndex(...args),
    lSet: (...args: unknown[]) => mockRedisLSet(...args),
    lRem: (...args: unknown[]) => mockRedisLRem(...args),
  }),
}));

import { WhatsAppService } from '../../src/services/whatsapp.service';

// Subclass that skips retry delays for fast tests
class FastWhatsAppService extends WhatsAppService {
  protected delay(): Promise<void> {
    return Promise.resolve();
  }
}

// ─── Fetch Mock ──────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch;

function okResponse() {
  return Promise.resolve({ ok: true } as Response);
}

function errorResponse(body: object) {
  return Promise.resolve({
    ok: false,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response);
}

function lastCallBody() {
  const raw = mockFetch.mock.calls[0][1].body as string;
  return JSON.parse(raw);
}

// ─── Tests ───────────────────────────────────────────────

describe('WhatsAppService — sendTextMessage', () => {
  let svc: FastWhatsAppService;

  beforeEach(() => {
    svc = new FastWhatsAppService();
    mockFetch.mockReset();
    mockFetch.mockImplementation(okResponse);
    mockRedisRPush.mockClear();
  });

  it('POSTs to the correct Messages endpoint', async () => {
    await svc.sendTextMessage('56912345678', 'Hola');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://graph.facebook.com/v18.0/test-phone-id/messages',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sets Authorization and Content-Type headers', async () => {
    await svc.sendTextMessage('56912345678', 'Hola');
    const headers = mockFetch.mock.calls[0][1].headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer test-token');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('sends the correct message structure', async () => {
    await svc.sendTextMessage('56912345678', 'Test body');
    const body = lastCallBody();
    expect(body.messaging_product).toBe('whatsapp');
    expect(body.to).toBe('56912345678');
    expect(body.type).toBe('text');
    expect(body.text.body).toBe('Test body');
  });

  it('throws after all retries fail and pushes to DLQ', async () => {
    mockFetch.mockImplementation(() => errorResponse({ error: { message: 'Invalid token' } }));
    await expect(svc.sendTextMessage('56912345678', 'x')).rejects.toThrow('WhatsApp API error');
    // 1 initial + 3 retries = 4 calls
    expect(mockFetch).toHaveBeenCalledTimes(4);
    // Should push to DLQ
    expect(mockRedisRPush).toHaveBeenCalledWith('whatsapp:dlq', expect.any(String));
  });

  it('retries and succeeds on second attempt', async () => {
    mockFetch
      .mockImplementationOnce(() => errorResponse({ error: { message: 'Rate limited' } }))
      .mockImplementationOnce(okResponse);

    await svc.sendTextMessage('56912345678', 'Retry test');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockRedisRPush).not.toHaveBeenCalled();
  });
});

describe('WhatsAppService — sendButtonMessage', () => {
  let svc: FastWhatsAppService;

  beforeEach(() => {
    svc = new FastWhatsAppService();
    mockFetch.mockReset();
    mockFetch.mockImplementation(okResponse);
  });

  it('sends interactive button message', async () => {
    await svc.sendButtonMessage('56912345678', 'Elige una opción:', [
      { id: 'yes', title: 'Sí' },
      { id: 'no', title: 'No' },
    ]);
    const body = lastCallBody();
    expect(body.type).toBe('interactive');
    expect(body.interactive.type).toBe('button');
    expect(body.interactive.body.text).toBe('Elige una opción:');
    expect(body.interactive.action.buttons).toHaveLength(2);
    expect(body.interactive.action.buttons[0].reply.id).toBe('yes');
    expect(body.interactive.action.buttons[0].type).toBe('reply');
  });

  it('limits buttons to 3 (WhatsApp API maximum)', async () => {
    await svc.sendButtonMessage('56912345678', 'Elige:', [
      { id: '1', title: 'Uno' },
      { id: '2', title: 'Dos' },
      { id: '3', title: 'Tres' },
      { id: '4', title: 'Cuatro' }, // should be dropped
    ]);
    const body = lastCallBody();
    expect(body.interactive.action.buttons).toHaveLength(3);
    expect(body.interactive.action.buttons.map((b: any) => b.reply.id)).toEqual(['1', '2', '3']);
  });
});

describe('WhatsAppService — sendListMessage', () => {
  let svc: FastWhatsAppService;

  beforeEach(() => {
    svc = new FastWhatsAppService();
    mockFetch.mockReset();
    mockFetch.mockImplementation(okResponse);
  });

  it('sends interactive list message with correct structure', async () => {
    await svc.sendListMessage('56912345678', 'Elige una opción:', 'Ver opciones', [
      {
        title: 'Pagos',
        rows: [
          { id: 'pay', title: 'Enviar pago', description: 'Transfiere dinero' },
          { id: 'charge', title: 'Cobrar' },
        ],
      },
    ]);
    const body = lastCallBody();
    expect(body.type).toBe('interactive');
    expect(body.interactive.type).toBe('list');
    expect(body.interactive.body.text).toBe('Elige una opción:');
    expect(body.interactive.action.button).toBe('Ver opciones');
    expect(body.interactive.action.sections).toHaveLength(1);
    expect(body.interactive.action.sections[0].title).toBe('Pagos');
    expect(body.interactive.action.sections[0].rows).toHaveLength(2);
    expect(body.interactive.action.sections[0].rows[0].id).toBe('pay');
    expect(body.interactive.action.sections[0].rows[0].description).toBe('Transfiere dinero');
  });

  it('truncates button text to 20 chars and section title to 24 chars', async () => {
    await svc.sendListMessage('56912345678', 'Body', 'A very long button text that exceeds twenty', [
      {
        title: 'This section title is way too long for the limit',
        rows: [{ id: 'r1', title: 'Row 1' }],
      },
    ]);
    const body = lastCallBody();
    expect(body.interactive.action.button.length).toBeLessThanOrEqual(20);
    expect(body.interactive.action.sections[0].title.length).toBeLessThanOrEqual(24);
  });

  it('row without description omits description field', async () => {
    await svc.sendListMessage('56912345678', 'Body', 'Menu', [
      { title: 'Section', rows: [{ id: 'r1', title: 'No desc' }] },
    ]);
    const body = lastCallBody();
    expect(body.interactive.action.sections[0].rows[0].description).toBeUndefined();
  });
});

describe('WhatsAppService — sendPaymentConfirmation', () => {
  let svc: FastWhatsAppService;

  beforeEach(() => {
    svc = new FastWhatsAppService();
    mockFetch.mockReset();
    mockFetch.mockImplementation(okResponse);
  });

  it('includes formatted amount in the message', async () => {
    await svc.sendPaymentConfirmation('56912345678', 50_000, 'Juan Pérez', '#WP-2025-ABCD1234');
    const body = lastCallBody();
    expect(body.text.body).toContain('50.000');
  });

  it('includes receiver name and reference', async () => {
    await svc.sendPaymentConfirmation('56912345678', 10_000, 'Ana López', '#WP-2025-XY');
    const body = lastCallBody();
    expect(body.text.body).toContain('Ana López');
    expect(body.text.body).toContain('#WP-2025-XY');
  });

  it('sends to the correct recipient', async () => {
    await svc.sendPaymentConfirmation('56987654321', 1_000, 'Pedro', '#ref');
    const body = lastCallBody();
    expect(body.to).toBe('56987654321');
  });
});

// ─── DLQ Static Methods ─────────────────────────────────

describe('WhatsAppService — DLQ operations', () => {
  beforeEach(() => {
    mockRedisLRange.mockClear();
    mockRedisLLen.mockClear();
    mockRedisDEL.mockClear();
    mockRedisLIndex.mockClear();
    mockRedisLSet.mockClear();
    mockRedisLRem.mockClear();
  });

  it('getDLQ returns parsed entries from Redis', async () => {
    const dlqEntry = JSON.stringify({ to: '56912345678', error: 'Timeout' });
    mockRedisLRange.mockResolvedValue([dlqEntry]);

    const result = await WhatsAppService.getDLQ();
    expect(result).toHaveLength(1);
    expect((result[0] as { to: string }).to).toBe('56912345678');
    expect(mockRedisLRange).toHaveBeenCalledWith('whatsapp:dlq', 0, 49);
  });

  it('getDLQ returns empty array on Redis error', async () => {
    mockRedisLRange.mockRejectedValue(new Error('Redis down'));
    const result = await WhatsAppService.getDLQ();
    expect(result).toEqual([]);
  });

  it('clearDLQ deletes the DLQ key and returns count', async () => {
    mockRedisLLen.mockResolvedValue(5);
    const count = await WhatsAppService.clearDLQ();
    expect(count).toBe(5);
    expect(mockRedisDEL).toHaveBeenCalledWith('whatsapp:dlq');
  });

  it('clearDLQ returns 0 on Redis error', async () => {
    mockRedisLLen.mockRejectedValue(new Error('Redis down'));
    const count = await WhatsAppService.clearDLQ();
    expect(count).toBe(0);
  });

  it('retryDLQEntry removes entry by index', async () => {
    mockRedisLIndex.mockResolvedValue(JSON.stringify({ to: '56912345678' }));
    const result = await WhatsAppService.retryDLQEntry(0);
    expect(result).toBe(true);
    expect(mockRedisLSet).toHaveBeenCalledWith('whatsapp:dlq', 0, '__REMOVED__');
    expect(mockRedisLRem).toHaveBeenCalledWith('whatsapp:dlq', 1, '__REMOVED__');
  });

  it('retryDLQEntry returns false when entry not found', async () => {
    mockRedisLIndex.mockResolvedValue(null);
    const result = await WhatsAppService.retryDLQEntry(99);
    expect(result).toBe(false);
  });

  it('retryDLQEntry returns false on Redis error', async () => {
    mockRedisLIndex.mockRejectedValue(new Error('Redis down'));
    const result = await WhatsAppService.retryDLQEntry(0);
    expect(result).toBe(false);
  });

  it('DLQ push handles Redis failure gracefully', async () => {
    mockRedisRPush.mockRejectedValue(new Error('Redis down'));
    const svc = new FastWhatsAppService();
    mockFetch.mockImplementation(() => errorResponse({ error: { message: 'API down' } }));

    // Should still throw the original error, not the DLQ error
    await expect(svc.sendTextMessage('56912345678', 'test')).rejects.toThrow('WhatsApp API error');
  });
});
