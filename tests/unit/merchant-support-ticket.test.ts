const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantSupportTicketService } from '../../src/services/merchant-support-ticket.service';

describe('MerchantSupportTicketService', () => {
  let s: MerchantSupportTicketService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantSupportTicketService(); mockRedisGet.mockResolvedValue(null); });

  it('creates ticket', async () => { const t = await s.createTicket({ merchantId: 'm1', subject: 'Pago no recibido', description: 'El cliente dice que pagó pero no aparece' }); expect(t.id).toMatch(/^tk_/); expect(t.status).toBe('OPEN'); expect(t.messages).toHaveLength(1); });
  it('rejects empty subject', async () => { await expect(s.createTicket({ merchantId: 'm1', subject: '', description: 'X' })).rejects.toThrow('Asunto'); });
  it('adds merchant message', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'tk_1', status: 'OPEN', messages: [] }));
    expect(await s.addMessage('tk_1', 'MERCHANT', 'Sigo esperando')).toBe(true);
  });
  it('adds support message and changes status', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'tk_1', status: 'OPEN', messages: [] }));
    await s.addMessage('tk_1', 'SUPPORT', 'Estamos revisando');
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.status).toBe('IN_PROGRESS');
  });
  it('rejects message on closed ticket', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'tk_1', status: 'CLOSED', messages: [] }));
    expect(await s.addMessage('tk_1', 'MERCHANT', 'Hola')).toBe(false);
  });
  it('resolves ticket', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'tk_1', status: 'IN_PROGRESS' }));
    expect(await s.resolveTicket('tk_1')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.status).toBe('RESOLVED');
  });
  it('closes ticket', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'tk_1', status: 'RESOLVED' }));
    expect(await s.closeTicket('tk_1')).toBe(true);
  });
  it('assigns ticket', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'tk_1', status: 'OPEN', assignedTo: null }));
    expect(await s.assignTicket('tk_1', 'agent-01')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.assignedTo).toBe('agent-01');
  });
});
