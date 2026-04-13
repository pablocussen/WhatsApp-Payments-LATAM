const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserBudgetEnvelopeService } from '../../src/services/user-budget-envelope.service';

describe('UserBudgetEnvelopeService', () => {
  let s: UserBudgetEnvelopeService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserBudgetEnvelopeService(); mockRedisGet.mockResolvedValue(null); });

  it('creates envelope with defaults', async () => {
    const e = await s.create({ userId: 'u1', name: 'Comida', category: 'Food', monthlyLimit: 200000 });
    expect(e.spent).toBe(0);
    expect(e.color).toBe('#06b6d4');
    expect(e.rolloverEnabled).toBe(false);
  });

  it('rejects zero limit', async () => {
    await expect(s.create({ userId: 'u1', name: 'x', category: 'y', monthlyLimit: 0 })).rejects.toThrow('positivo');
  });

  it('rejects duplicate name case insensitive', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ name: 'Comida' }]));
    await expect(s.create({ userId: 'u1', name: 'COMIDA', category: 'y', monthlyLimit: 1000 })).rejects.toThrow('Ya existe');
  });

  it('rejects over 15 envelopes', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(Array.from({ length: 15 }, (_, i) => ({ id: 'e' + i, name: 'n' + i }))));
    await expect(s.create({ userId: 'u1', name: 'Extra', category: 'y', monthlyLimit: 1000 })).rejects.toThrow('15');
  });

  it('records spend', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'e1', spent: 5000, monthlyLimit: 100000 }]));
    const e = await s.recordSpend('u1', 'e1', 3000);
    expect(e?.spent).toBe(8000);
  });

  it('rejects negative spend', async () => {
    await expect(s.recordSpend('u1', 'e1', -100)).rejects.toThrow('positivo');
  });

  it('resets monthly with rollover', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'e1', monthlyLimit: 100000, spent: 60000, rolloverEnabled: true },
      { id: 'e2', monthlyLimit: 50000, spent: 50000, rolloverEnabled: false },
    ]));
    await s.resetMonthly('u1');
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].monthlyLimit).toBe(140000);
    expect(saved[0].spent).toBe(0);
    expect(saved[1].monthlyLimit).toBe(50000);
  });

  it('deletes envelope', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'e1' }, { id: 'e2' }]));
    expect(await s.delete('u1', 'e1')).toBe(true);
  });

  it('returns over limit envelopes', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'e1', spent: 150000, monthlyLimit: 100000 },
      { id: 'e2', spent: 30000, monthlyLimit: 50000 },
    ]));
    const over = await s.getOverLimit('u1');
    expect(over).toHaveLength(1);
    expect(over[0].id).toBe('e1');
  });

  it('computes total spent percentage', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { spent: 30000, monthlyLimit: 100000 },
      { spent: 20000, monthlyLimit: 100000 },
    ]));
    const t = await s.getTotalSpent('u1');
    expect(t.spent).toBe(50000);
    expect(t.limit).toBe(200000);
    expect(t.percentage).toBe(25);
  });

  it('caps progress at 100', () => {
    const p = s.computeProgress({ id: 'e1', userId: 'u1', name: 'x', category: 'y', monthlyLimit: 1000, spent: 1500, color: '', icon: '', rolloverEnabled: false, createdAt: '', updatedAt: '' });
    expect(p).toBe(100);
  });
});
