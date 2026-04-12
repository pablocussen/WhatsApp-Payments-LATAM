const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserBillSplitService } from '../../src/services/user-bill-split.service';

describe('UserBillSplitService', () => {
  let s: UserBillSplitService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserBillSplitService(); mockRedisGet.mockResolvedValue(null); });

  it('creates equal split', async () => {
    const sp = await s.createSplit({
      creatorId: 'u1', title: 'Cena', totalAmount: 30000, splitType: 'EQUAL',
      participants: [{ phone: '+569A' }, { phone: '+569B' }, { phone: '+569C' }],
    });
    expect(sp.id).toMatch(/^split_/);
    expect(sp.participants).toHaveLength(3);
    expect(sp.participants[0].amountOwed).toBe(10000);
  });

  it('creates custom split', async () => {
    const sp = await s.createSplit({
      creatorId: 'u1', title: 'Pizza', totalAmount: 25000, splitType: 'CUSTOM',
      participants: [{ phone: '+569A', amount: 15000 }, { phone: '+569B', amount: 10000 }],
    });
    expect(sp.participants[0].amountOwed).toBe(15000);
    expect(sp.participants[1].amountOwed).toBe(10000);
  });

  it('creates percentage split', async () => {
    const sp = await s.createSplit({
      creatorId: 'u1', title: 'Renta', totalAmount: 100000, splitType: 'PERCENTAGE',
      participants: [{ phone: '+569A', percentage: 60 }, { phone: '+569B', percentage: 40 }],
    });
    expect(sp.participants[0].amountOwed).toBe(60000);
    expect(sp.participants[1].amountOwed).toBe(40000);
  });

  it('rejects below 2 participants', async () => {
    await expect(s.createSplit({
      creatorId: 'u1', title: 'X', totalAmount: 1000, splitType: 'EQUAL',
      participants: [{ phone: '+569' }],
    })).rejects.toThrow('Minimo 2');
  });

  it('rejects mismatched custom sum', async () => {
    await expect(s.createSplit({
      creatorId: 'u1', title: 'X', totalAmount: 10000, splitType: 'CUSTOM',
      participants: [{ phone: '+569A', amount: 3000 }, { phone: '+569B', amount: 3000 }],
    })).rejects.toThrow('coincide');
  });

  it('records payment', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      id: 'split_1', participants: [
        { phone: '+569A', amountOwed: 10000, amountPaid: 0, paid: false },
        { phone: '+569B', amountOwed: 10000, amountPaid: 0, paid: false },
      ], status: 'PENDING',
    }));
    const r = await s.recordPayment('split_1', '+569A', 10000);
    expect(r.success).toBe(true);
    expect(r.split?.status).toBe('PARTIAL');
    expect(r.split?.participants[0].paid).toBe(true);
  });

  it('completes when all pay', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      id: 'split_1', participants: [
        { phone: '+569A', amountOwed: 10000, amountPaid: 10000, paid: true, paidAt: '2026-04-10' },
        { phone: '+569B', amountOwed: 10000, amountPaid: 0, paid: false },
      ], status: 'PARTIAL',
    }));
    const r = await s.recordPayment('split_1', '+569B', 10000);
    expect(r.split?.status).toBe('COMPLETED');
  });

  it('rejects payment for unknown participant', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'split_1', participants: [{ phone: '+569A' }], status: 'PENDING' }));
    expect((await s.recordPayment('split_1', '+569Z', 5000)).success).toBe(false);
  });

  it('cancels split', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'split_1', status: 'PENDING', participants: [] }));
    expect(await s.cancelSplit('split_1')).toBe(true);
  });

  it('cannot cancel completed', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'split_1', status: 'COMPLETED', participants: [] }));
    expect(await s.cancelSplit('split_1')).toBe(false);
  });

  it('formats summary', () => {
    const f = s.formatSplitSummary({
      title: 'Cena', totalAmount: 30000,
      participants: [{ paid: true }, { paid: true }, { paid: false }],
      status: 'PARTIAL',
    } as any);
    expect(f).toContain('Cena');
    expect(f).toContain('$30.000');
    expect(f).toContain('2/3');
  });
});
