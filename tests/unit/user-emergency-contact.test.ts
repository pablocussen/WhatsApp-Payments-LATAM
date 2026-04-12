const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserEmergencyContactService } from '../../src/services/user-emergency-contact.service';

describe('UserEmergencyContactService', () => {
  let s: UserEmergencyContactService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserEmergencyContactService(); mockRedisGet.mockResolvedValue(null); });

  it('adds contact', async () => {
    const c = await s.addContact({ userId: 'u1', name: 'Maria', phone: '+569', relationship: 'hermana' });
    expect(c.id).toMatch(/^ec_/);
    expect(c.priority).toBe(1);
    expect(c.notifyOnLock).toBe(true);
  });

  it('rejects over 3 contacts', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]));
    await expect(s.addContact({ userId: 'u1', name: 'X', phone: '+569', relationship: 'X' })).rejects.toThrow('3');
  });

  it('rejects missing phone', async () => {
    await expect(s.addContact({ userId: 'u1', name: 'X', phone: '', relationship: 'X' })).rejects.toThrow('Telefono');
  });

  it('removes contact and reorders', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'c1', priority: 1 }, { id: 'c2', priority: 2 }, { id: 'c3', priority: 3 },
    ]));
    expect(await s.removeContact('u1', 'c1')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].priority).toBe(1);
    expect(saved[1].priority).toBe(2);
  });

  it('updates priority', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'c1', priority: 3 }]));
    expect(await s.updatePriority('u1', 'c1', 1)).toBe(true);
  });

  it('rejects invalid priority', async () => {
    expect(await s.updatePriority('u1', 'c1', 5)).toBe(false);
  });

  it('gets by priority', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'c1', priority: 1 },
      { id: 'c2', priority: 2 },
    ]));
    const c = await s.getByPriority('u1', 2);
    expect(c?.id).toBe('c2');
  });

  it('returns empty for new user', async () => {
    expect(await s.getContacts('u1')).toEqual([]);
  });
});
