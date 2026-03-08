/**
 * Unit tests for WhatsAppService.
 * global.fetch is mocked so no real HTTP calls are made.
 */

jest.mock('../../src/config/environment', () => ({
  env: {
    WHATSAPP_API_URL: 'https://graph.facebook.com/v18.0',
    WHATSAPP_PHONE_NUMBER_ID: 'test-phone-id',
    WHATSAPP_API_TOKEN: 'test-token',
    WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
  },
}));

import { WhatsAppService } from '../../src/services/whatsapp.service';

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
  let svc: WhatsAppService;

  beforeEach(() => {
    svc = new WhatsAppService();
    mockFetch.mockReset();
    mockFetch.mockImplementation(okResponse);
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

  it('throws on API error response', async () => {
    mockFetch.mockImplementation(() => errorResponse({ error: { message: 'Invalid token' } }));
    await expect(svc.sendTextMessage('56912345678', 'x')).rejects.toThrow('WhatsApp API error');
  });
});

describe('WhatsAppService — sendButtonMessage', () => {
  let svc: WhatsAppService;

  beforeEach(() => {
    svc = new WhatsAppService();
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
  let svc: WhatsAppService;

  beforeEach(() => {
    svc = new WhatsAppService();
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
  let svc: WhatsAppService;

  beforeEach(() => {
    svc = new WhatsAppService();
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
