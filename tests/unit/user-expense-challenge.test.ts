const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserExpenseChallengeService } from '../../src/services/user-expense-challenge.service';

describe('UserExpenseChallengeService', () => {
  let s: UserExpenseChallengeService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserExpenseChallengeService(); mockRedisGet.mockResolvedValue(null); });

  it('creates challenge', async () => {
    const c = await s.create({ userId: 'u1', type: 'SAVE_AMOUNT', name: 'Ahorrar 50k', description: 'en 30 dias', targetAmount: 50000, durationDays: 30 });
    expect(c.id).toMatch(/^ch_/);
    expect(c.status).toBe('ACTIVE');
    expect(c.rewardPoints).toBe(300);
  });

  it('rejects invalid duration', async () => {
    await expect(s.create({ userId: 'u1', type: 'SAVE_AMOUNT', name: 'x', description: 'y', durationDays: 100 })).rejects.toThrow('90');
  });

  it('rejects long name', async () => {
    await expect(s.create({ userId: 'u1', type: 'SAVE_AMOUNT', name: 'x'.repeat(51), description: 'y', durationDays: 10 })).rejects.toThrow('50');
  });

  it('rejects over 5 active', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ id: 'c' + i, status: 'ACTIVE' }))));
    await expect(s.create({ userId: 'u1', type: 'SAVE_AMOUNT', name: 'x', description: 'y', durationDays: 10 })).rejects.toThrow('5');
  });

  it('caps reward points at 500', async () => {
    const c = await s.create({ userId: 'u1', type: 'SAVE_AMOUNT', name: 'Big', description: 'y', durationDays: 90 });
    expect(c.rewardPoints).toBe(500);
  });

  it('updates progress and completes', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'c1', status: 'ACTIVE', targetAmount: 1000, currentProgress: 0 }]));
    const c = await s.updateProgress('u1', 'c1', 1000);
    expect(c?.status).toBe('COMPLETED');
  });

  it('abandons active challenge', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'c1', status: 'ACTIVE' }]));
    expect(await s.abandon('u1', 'c1')).toBe(true);
  });

  it('marks expired challenges as failed', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'c1', status: 'ACTIVE', endDate: past, targetAmount: 1000, currentProgress: 500 },
      { id: 'c2', status: 'ACTIVE', endDate: past, targetAmount: 1000, currentProgress: 1000 },
    ]));
    expect(await s.checkExpired('u1')).toBe(2);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].status).toBe('FAILED');
    expect(saved[1].status).toBe('COMPLETED');
  });

  it('computes stats', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'COMPLETED', rewardPoints: 100 },
      { status: 'COMPLETED', rewardPoints: 200 },
      { status: 'FAILED', rewardPoints: 50 },
      { status: 'ACTIVE', rewardPoints: 150 },
    ]));
    const stats = await s.getStats('u1');
    expect(stats.total).toBe(4);
    expect(stats.completed).toBe(2);
    expect(stats.totalPoints).toBe(300);
  });
});
