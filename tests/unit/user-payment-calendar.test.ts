const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserPaymentCalendarService } from '../../src/services/user-payment-calendar.service';

describe('UserPaymentCalendarService', () => {
  let s: UserPaymentCalendarService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserPaymentCalendarService(); mockRedisGet.mockResolvedValue(null); });

  it('adds event', async () => {
    const e = await s.addEvent({ userId: 'u1', type: 'BILL', title: 'Luz', amount: 45000, date: '2026-05-01' });
    expect(e.id).toMatch(/^cal_/);
    expect(e.completed).toBe(false);
    expect(e.recurring).toBe(false);
  });

  it('rejects zero amount', async () => {
    await expect(s.addEvent({ userId: 'u1', type: 'BILL', title: 'x', amount: 0, date: '2026-05-01' })).rejects.toThrow('positivo');
  });

  it('rejects long title', async () => {
    await expect(s.addEvent({ userId: 'u1', type: 'BILL', title: 'x'.repeat(61), amount: 100, date: '2026-05-01' })).rejects.toThrow('60');
  });

  it('rejects invalid date', async () => {
    await expect(s.addEvent({ userId: 'u1', type: 'BILL', title: 'x', amount: 100, date: 'not-a-date' })).rejects.toThrow('invalida');
  });

  it('rejects recurring without interval', async () => {
    await expect(s.addEvent({ userId: 'u1', type: 'BILL', title: 'x', amount: 100, date: '2026-05-01', recurring: true })).rejects.toThrow('intervalo');
  });

  it('marks completed and creates next recurring', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'e1', userId: 'u1', type: 'BILL', title: 'Luz', amount: 45000,
      date: '2026-05-01T00:00:00.000Z', recurring: true, recurringInterval: 'MONTHLY',
      notified: false, completed: false, createdAt: '',
    }]));
    await s.markCompleted('u1', 'e1');
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved).toHaveLength(2);
    expect(saved[0].completed).toBe(true);
    expect(saved[1].completed).toBe(false);
    expect(new Date(saved[1].date).getMonth()).toBe(5);
  });

  it('marks completed non-recurring', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'e1', completed: false, recurring: false, date: '2026-05-01' }]));
    const e = await s.markCompleted('u1', 'e1');
    expect(e?.completed).toBe(true);
  });

  it('deletes event', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'e1' }, { id: 'e2' }]));
    expect(await s.delete('u1', 'e1')).toBe(true);
  });

  it('returns upcoming within window', async () => {
    const soon = new Date(Date.now() + 3 * 86400000).toISOString();
    const far = new Date(Date.now() + 30 * 86400000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'e1', completed: false, date: soon },
      { id: 'e2', completed: false, date: far },
    ]));
    const up = await s.getUpcoming('u1', 7);
    expect(up).toHaveLength(1);
    expect(up[0].id).toBe('e1');
  });

  it('returns overdue events', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'e1', completed: false, date: past },
      { id: 'e2', completed: true, date: past },
    ]));
    const over = await s.getOverdue('u1');
    expect(over).toHaveLength(1);
  });

  it('computes month total', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { amount: 45000, date: '2026-05-05T00:00:00.000Z' },
      { amount: 30000, date: '2026-05-20T00:00:00.000Z' },
      { amount: 10000, date: '2026-06-01T00:00:00.000Z' },
    ]));
    const total = await s.getMonthTotal('u1', 2026, 4);
    expect(total).toBe(75000);
  });
});
