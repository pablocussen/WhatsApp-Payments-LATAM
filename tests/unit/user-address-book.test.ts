const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserAddressBookService } from '../../src/services/user-address-book.service';

describe('UserAddressBookService', () => {
  let s: UserAddressBookService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserAddressBookService(); mockRedisGet.mockResolvedValue(null); });

  it('adds contact', async () => { const c = await s.addContact('u1', '+569123', 'Juan'); expect(c.id).toMatch(/^ct_/); expect(c.favorite).toBe(false); });
  it('rejects duplicate phone', async () => { mockRedisGet.mockResolvedValue(JSON.stringify([{ phone: '+569123' }])); await expect(s.addContact('u1', '+569123', 'Juan')).rejects.toThrow('ya existe'); });
  it('returns empty for new user', async () => { expect(await s.getContacts('u1')).toEqual([]); });
  it('gets favorites', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'c1', favorite: true }, { id: 'c2', favorite: false }]));
    expect(await s.getFavorites('u1')).toHaveLength(1);
  });
  it('gets frequent contacts', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'c1', paymentCount: 5 }, { id: 'c2', paymentCount: 20 }, { id: 'c3', paymentCount: 10 }]));
    const freq = await s.getFrequent('u1', 2);
    expect(freq[0].paymentCount).toBe(20);
  });
  it('toggles favorite', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'c1', favorite: false }]));
    expect(await s.toggleFavorite('u1', 'c1')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].favorite).toBe(true);
  });
  it('records payment to contact', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'c1', phone: '+569123', totalPaid: 10000, paymentCount: 2 }]));
    await s.recordPayment('u1', '+569123', 5000);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].totalPaid).toBe(15000);
    expect(saved[0].paymentCount).toBe(3);
  });
  it('deletes contact', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'c1' }, { id: 'c2' }]));
    expect(await s.deleteContact('u1', 'c1')).toBe(true);
  });
  it('searches by name', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'c1', name: 'Juan Pérez', phone: '+569', nickname: null }, { id: 'c2', name: 'María', phone: '+568', nickname: null }]));
    const results = await s.searchContacts('u1', 'juan');
    expect(results).toHaveLength(1);
  });
});
