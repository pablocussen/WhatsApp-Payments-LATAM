const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserQuickActionService } from '../../src/services/user-quick-action.service';

describe('UserQuickActionService', () => {
  let s: UserQuickActionService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserQuickActionService(); mockRedisGet.mockResolvedValue(null); });

  it('creates action', async () => {
    const a = await s.createAction({ userId: 'u1', name: 'Pagar Mama', icon: '👩', type: 'PAY_CONTACT', recipientPhone: '+569', amount: 50000 });
    expect(a.id).toMatch(/^qa_/);
    expect(a.position).toBe(1);
  });

  it('rejects long name', async () => {
    await expect(s.createAction({ userId: 'u1', name: 'x'.repeat(31), icon: 'X', type: 'PAY_CONTACT' })).rejects.toThrow('30');
  });

  it('rejects over 8 actions', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(Array.from({ length: 8 }, (_, i) => ({ id: 'a' + i }))));
    await expect(s.createAction({ userId: 'u1', name: 'Extra', icon: 'X', type: 'PAY_CONTACT' })).rejects.toThrow('8');
  });

  it('records usage', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'a1', usageCount: 5 }]));
    const a = await s.useAction('u1', 'a1');
    expect(a?.usageCount).toBe(6);
  });

  it('returns most used', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'a1', usageCount: 5 },
      { id: 'a2', usageCount: 20 },
      { id: 'a3', usageCount: 10 },
    ]));
    const top = await s.getMostUsed('u1', 2);
    expect(top[0].id).toBe('a2');
    expect(top[1].id).toBe('a3');
  });

  it('reorders actions', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'a1', position: 1 }, { id: 'a2', position: 2 }, { id: 'a3', position: 3 },
    ]));
    expect(await s.reorder('u1', ['a3', 'a1', 'a2'])).toBe(true);
  });

  it('deletes action and reorders', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'a1', position: 1 }, { id: 'a2', position: 2 }, { id: 'a3', position: 3 },
    ]));
    expect(await s.deleteAction('u1', 'a2')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].position).toBe(1);
    expect(saved[1].position).toBe(2);
  });
});
