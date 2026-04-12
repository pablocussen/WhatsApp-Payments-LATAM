const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantCustomerNoteService } from '../../src/services/merchant-customer-note.service';

describe('MerchantCustomerNoteService', () => {
  let s: MerchantCustomerNoteService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantCustomerNoteService(); mockRedisGet.mockResolvedValue(null); });

  it('adds note', async () => {
    const n = await s.addNote({ merchantId: 'm1', customerPhone: '+569', content: 'Cliente frecuente', createdBy: 'admin' });
    expect(n.id).toMatch(/^note_/);
    expect(n.priority).toBe('NORMAL');
  });

  it('rejects long content', async () => {
    await expect(s.addNote({ merchantId: 'm1', customerPhone: '+569', content: 'x'.repeat(501), createdBy: 'admin' })).rejects.toThrow('500');
  });

  it('rejects over max notes', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ id: 'n' + i }))));
    await expect(s.addNote({ merchantId: 'm1', customerPhone: '+569', content: 'Nota', createdBy: 'admin' })).rejects.toThrow('20');
  });

  it('filters high priority', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'n1', priority: 'HIGH' },
      { id: 'n2', priority: 'NORMAL' },
      { id: 'n3', priority: 'HIGH' },
    ]));
    const high = await s.getHighPriority('m1', '+569');
    expect(high).toHaveLength(2);
  });

  it('searches by tag', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'n1', tags: ['vip', 'loyal'] },
      { id: 'n2', tags: ['new'] },
      { id: 'n3', tags: ['vip'] },
    ]));
    const tagged = await s.searchByTag('m1', '+569', 'vip');
    expect(tagged).toHaveLength(2);
  });

  it('updates note', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'n1', content: 'old', priority: 'NORMAL', tags: [] }]));
    const u = await s.updateNote('m1', '+569', 'n1', { content: 'new', priority: 'HIGH' });
    expect(u?.content).toBe('new');
    expect(u?.priority).toBe('HIGH');
  });

  it('returns null for missing note update', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([]));
    expect(await s.updateNote('m1', '+569', 'nope', { content: 'x' })).toBeNull();
  });

  it('deletes note', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'n1' }, { id: 'n2' }]));
    expect(await s.deleteNote('m1', '+569', 'n1')).toBe(true);
  });
});
