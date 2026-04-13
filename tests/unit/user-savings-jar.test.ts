const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserSavingsJarService } from '../../src/services/user-savings-jar.service';

describe('UserSavingsJarService', () => {
  let s: UserSavingsJarService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserSavingsJarService(); mockRedisGet.mockResolvedValue(null); });

  it('creates open jar', async () => {
    const j = await s.create({ userId: 'u1', name: 'iPhone', emoji: '📱', targetAmount: 900000 });
    expect(j.status).toBe('OPEN');
    expect(j.breakPenaltyPercent).toBe(5);
  });

  it('creates locked jar with future date', async () => {
    const future = new Date(Date.now() + 90 * 86400000).toISOString();
    const j = await s.create({ userId: 'u1', name: 'Vacaciones', emoji: '🌴', targetAmount: 500000, lockUntil: future });
    expect(j.status).toBe('LOCKED');
  });

  it('rejects amount out of range', async () => {
    await expect(s.create({ userId: 'u1', name: 'x', emoji: 'y', targetAmount: 100 })).rejects.toThrow('5.000');
    await expect(s.create({ userId: 'u1', name: 'x', emoji: 'y', targetAmount: 99999999 })).rejects.toThrow('50.000.000');
  });

  it('rejects invalid penalty', async () => {
    await expect(s.create({ userId: 'u1', name: 'x', emoji: 'y', targetAmount: 10000, breakPenaltyPercent: 60 })).rejects.toThrow('Penalidad');
  });

  it('deposits and completes on target', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'j1', status: 'OPEN', currentAmount: 800000, targetAmount: 900000, deposits: [],
    }]));
    const j = await s.deposit('u1', 'j1', 100000);
    expect(j?.status).toBe('COMPLETED');
    expect(j?.completedAt).toBeDefined();
  });

  it('rejects deposit on completed', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'j1', status: 'COMPLETED' }]));
    await expect(s.deposit('u1', 'j1', 1000)).rejects.toThrow('no acepta');
  });

  it('breaks unlocked jar without penalty', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'j1', status: 'OPEN', currentAmount: 50000, targetAmount: 100000,
      breakPenaltyPercent: 5, deposits: [],
    }]));
    const result = await s.breakJar('u1', 'j1');
    expect(result?.refunded).toBe(50000);
    expect(result?.penalty).toBe(0);
  });

  it('applies penalty when breaking locked jar', async () => {
    const future = new Date(Date.now() + 30 * 86400000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'j1', status: 'LOCKED', currentAmount: 100000, targetAmount: 500000,
      breakPenaltyPercent: 10, lockUntil: future, deposits: [],
    }]));
    const result = await s.breakJar('u1', 'j1');
    expect(result?.penalty).toBe(10000);
    expect(result?.refunded).toBe(90000);
  });

  it('withdraws from completed jar', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'j1', status: 'COMPLETED', currentAmount: 900000,
    }]));
    const result = await s.withdraw('u1', 'j1');
    expect(result?.amount).toBe(900000);
  });

  it('rejects withdraw from open jar', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'j1', status: 'OPEN' }]));
    await expect(s.withdraw('u1', 'j1')).rejects.toThrow('completas');
  });

  it('computes progress', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'j1', currentAmount: 250000, targetAmount: 1000000,
    }]));
    expect(await s.getProgress('u1', 'j1')).toBe(25);
  });

  it('sums total saved excluding broken', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'OPEN', currentAmount: 100000 },
      { status: 'COMPLETED', currentAmount: 500000 },
      { status: 'BROKEN', currentAmount: 999999 },
    ]));
    expect(await s.getTotalSaved('u1')).toBe(600000);
  });
});
