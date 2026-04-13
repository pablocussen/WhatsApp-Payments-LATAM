const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserSharedExpenseService } from '../../src/services/user-shared-expense.service';

describe('UserSharedExpenseService', () => {
  let s: UserSharedExpenseService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserSharedExpenseService(); mockRedisGet.mockResolvedValue(null); });

  it('creates expense with equal split', async () => {
    const e = await s.create({
      groupId: 'g1',
      ownerId: 'u1',
      description: 'Cena',
      totalAmount: 60000,
      paidBy: 'u1',
      participants: [
        { userId: 'u1', name: 'Pablo' },
        { userId: 'u2', name: 'Maria' },
        { userId: 'u3', name: 'Juan' },
      ],
      splitEqual: true,
    });
    expect(e.participants[0].share).toBe(20000);
    expect(e.participants[0].paid).toBe(60000);
    expect(e.participants[1].paid).toBe(0);
  });

  it('creates expense with custom shares', async () => {
    const e = await s.create({
      groupId: 'g1',
      ownerId: 'u1',
      description: 'Arriendo',
      totalAmount: 100000,
      paidBy: 'u1',
      participants: [
        { userId: 'u1', name: 'Pablo', share: 60000 },
        { userId: 'u2', name: 'Maria', share: 40000 },
      ],
    });
    expect(e.participants[0].share).toBe(60000);
  });

  it('rejects mismatched shares', async () => {
    await expect(s.create({
      groupId: 'g1', ownerId: 'u1', description: 'x', totalAmount: 100,
      paidBy: 'u1',
      participants: [
        { userId: 'u1', name: 'a', share: 30 },
        { userId: 'u2', name: 'b', share: 30 },
      ],
    })).rejects.toThrow('sumar');
  });

  it('rejects paidBy not in participants', async () => {
    await expect(s.create({
      groupId: 'g1', ownerId: 'u1', description: 'x', totalAmount: 100,
      paidBy: 'u99',
      participants: [
        { userId: 'u1', name: 'a' },
        { userId: 'u2', name: 'b' },
      ],
      splitEqual: true,
    })).rejects.toThrow('entre los participantes');
  });

  it('rejects less than 2 participants', async () => {
    await expect(s.create({
      groupId: 'g1', ownerId: 'u1', description: 'x', totalAmount: 100,
      paidBy: 'u1',
      participants: [{ userId: 'u1', name: 'a' }],
      splitEqual: true,
    })).rejects.toThrow('2 participantes');
  });

  it('settles expense', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'e1', status: 'UNSETTLED',
      participants: [{ userId: 'u1', share: 50, paid: 100 }, { userId: 'u2', share: 50, paid: 0 }],
    }]));
    const e = await s.settle('g1', 'e1');
    expect(e?.status).toBe('SETTLED');
    expect(e?.participants[1].paid).toBe(50);
  });

  it('computes balances correctly', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'e1', status: 'UNSETTLED',
      participants: [
        { userId: 'u1', share: 20000, paid: 60000 },
        { userId: 'u2', share: 20000, paid: 0 },
        { userId: 'u3', share: 20000, paid: 0 },
      ],
    }]));
    const balances = await s.computeBalances('g1');
    expect(balances.u1).toBe(40000);
    expect(balances.u2).toBe(-20000);
    expect(balances.u3).toBe(-20000);
  });

  it('excludes settled expenses from balances', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'e1', status: 'SETTLED',
      participants: [{ userId: 'u1', share: 50, paid: 100 }, { userId: 'u2', share: 50, paid: 0 }],
    }]));
    const balances = await s.computeBalances('g1');
    expect(Object.keys(balances)).toHaveLength(0);
  });

  it('computes optimal transfers', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'e1', status: 'UNSETTLED',
      participants: [
        { userId: 'u1', share: 10000, paid: 60000 },
        { userId: 'u2', share: 20000, paid: 0 },
        { userId: 'u3', share: 30000, paid: 0 },
      ],
    }]));
    const transfers = await s.getOptimalTransfers('g1');
    expect(transfers.length).toBeGreaterThan(0);
    const totalTransferred = transfers.reduce((s, t) => s + t.amount, 0);
    expect(totalTransferred).toBe(50000);
  });

  it('counts unsettled', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'UNSETTLED' }, { status: 'SETTLED' }, { status: 'UNSETTLED' },
    ]));
    expect(await s.getUnsettledCount('g1')).toBe(2);
  });
});
