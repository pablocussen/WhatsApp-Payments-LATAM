const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { WhatsAppTemplateMessageService } from '../../src/services/whatsapp-template-message.service';

describe('WhatsAppTemplateMessageService', () => {
  let s: WhatsAppTemplateMessageService;
  beforeEach(() => { jest.clearAllMocks(); s = new WhatsAppTemplateMessageService(); mockRedisGet.mockResolvedValue(null); });

  it('creates template with variables', async () => {
    const t = await s.createTemplate({ merchantId: 'm1', name: 'Welcome', category: 'TRANSACTIONAL', language: 'es', bodyText: 'Hola {{name}}, tu pedido {{orderId}} esta listo.' });
    expect(t.id).toMatch(/^wat_/);
    expect(t.variables).toEqual(['name', 'orderId']);
    expect(t.approved).toBe(false);
  });
  it('rejects long text', async () => {
    await expect(s.createTemplate({ merchantId: 'm1', name: 'X', category: 'MARKETING', language: 'es', bodyText: 'x'.repeat(1025) })).rejects.toThrow('1024');
  });
  it('approves template', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'wat_1', approved: false }));
    expect(await s.approveTemplate('wat_1')).toBe(true);
  });
  it('renders approved template', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'wat_1', approved: true, bodyText: 'Hola {{name}}!', variables: ['name'], usageCount: 0 }));
    expect(await s.render('wat_1', { name: 'Juan' })).toBe('Hola Juan!');
  });
  it('rejects render of unapproved', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'wat_1', approved: false }));
    expect(await s.render('wat_1', {})).toBeNull();
  });
  it('returns null for missing', async () => {
    expect(await s.getTemplate('nope')).toBeNull();
  });
});
