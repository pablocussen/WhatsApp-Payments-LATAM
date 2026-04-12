const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserBillReminderService } from '../../src/services/user-bill-reminder.service';

describe('UserBillReminderService', () => {
  let s: UserBillReminderService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserBillReminderService(); mockRedisGet.mockResolvedValue(null); });

  it('creates reminder', async () => {
    const r = await s.createReminder({ userId: 'u1', name: 'Luz', category: 'ELECTRICITY', amount: 30000, dueDay: 15 });
    expect(r.id).toMatch(/^bill_/);
    expect(r.dueDay).toBe(15);
    expect(r.autopay).toBe(false);
  });

  it('rejects invalid day', async () => {
    await expect(s.createReminder({ userId: 'u1', name: 'X', category: 'OTHER', amount: 1000, dueDay: 30 })).rejects.toThrow('1 y 28');
  });

  it('rejects low amount', async () => {
    await expect(s.createReminder({ userId: 'u1', name: 'X', category: 'OTHER', amount: 50, dueDay: 5 })).rejects.toThrow('100');
  });

  it('rejects over 20', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(Array.from({ length: 20 }, (_, i) => ({ id: 'b' + i }))));
    await expect(s.createReminder({ userId: 'u1', name: 'X', category: 'OTHER', amount: 1000, dueDay: 5 })).rejects.toThrow('20');
  });

  it('marks paid', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'b1', paidThisMonth: false }]));
    expect(await s.markPaid('u1', 'b1')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].paidThisMonth).toBe(true);
  });

  it('gets unpaid bills', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'b1', paidThisMonth: false },
      { id: 'b2', paidThisMonth: true },
      { id: 'b3', paidThisMonth: false },
    ]));
    expect(await s.getUnpaidBills('u1')).toHaveLength(2);
  });

  it('calculates total monthly', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { amount: 30000 }, { amount: 50000 }, { amount: 20000 },
    ]));
    expect(await s.getTotalMonthly('u1')).toBe(100000);
  });

  it('formats summary', () => {
    const f = s.formatReminderSummary({ name: 'Luz', amount: 30000, dueDay: 15, paidThisMonth: false, autopay: true } as any);
    expect(f).toContain('Luz');
    expect(f).toContain('$30.000');
    expect(f).toContain('autopay');
    expect(f).toContain('pendiente');
  });
});
