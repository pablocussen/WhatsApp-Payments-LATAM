const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserSubscriptionTrackerService } from '../../src/services/user-subscription-tracker.service';

describe('UserSubscriptionTrackerService', () => {
  let s: UserSubscriptionTrackerService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserSubscriptionTrackerService(); mockRedisGet.mockResolvedValue(null); });

  it('adds subscription', async () => {
    const sub = await s.add({ userId: 'u1', name: 'Netflix', amount: 7990, frequency: 'MONTHLY', category: 'Streaming' });
    expect(sub.status).toBe('ACTIVE');
    expect(sub.id).toMatch(/^sub_/);
  });

  it('rejects zero amount', async () => {
    await expect(s.add({ userId: 'u1', name: 'x', amount: 0, frequency: 'MONTHLY', category: 'y' })).rejects.toThrow('positivo');
  });

  it('rejects over 30 subs', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(Array.from({ length: 30 }, (_, i) => ({ id: 's' + i }))));
    await expect(s.add({ userId: 'u1', name: 'x', amount: 100, frequency: 'MONTHLY', category: 'y' })).rejects.toThrow('30');
  });

  it('cancels active subscription', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 's1', status: 'ACTIVE' }]));
    expect(await s.cancel('u1', 's1')).toBe(true);
  });

  it('pauses active subscription', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 's1', status: 'ACTIVE' }]));
    expect(await s.pause('u1', 's1')).toBe(true);
  });

  it('does not pause cancelled', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 's1', status: 'CANCELLED' }]));
    expect(await s.pause('u1', 's1')).toBe(false);
  });

  it('computes monthly total across frequencies', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'ACTIVE', amount: 10000, frequency: 'MONTHLY' },
      { status: 'ACTIVE', amount: 1000, frequency: 'WEEKLY' },
      { status: 'ACTIVE', amount: 120000, frequency: 'YEARLY' },
      { status: 'CANCELLED', amount: 99999, frequency: 'MONTHLY' },
    ]));
    const total = await s.getMonthlyTotal('u1');
    expect(total).toBeCloseTo(10000 + 4330 + 10000, 0);
  });

  it('returns upcoming subs within window', async () => {
    const soon = new Date(Date.now() + 3 * 86400000).toISOString();
    const later = new Date(Date.now() + 20 * 86400000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 's1', status: 'ACTIVE', nextChargeAt: soon },
      { id: 's2', status: 'ACTIVE', nextChargeAt: later },
    ]));
    const up = await s.getUpcoming('u1', 7);
    expect(up).toHaveLength(1);
    expect(up[0].id).toBe('s1');
  });

  it('groups by category', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'ACTIVE', amount: 7990, category: 'Streaming' },
      { status: 'ACTIVE', amount: 4990, category: 'Streaming' },
      { status: 'ACTIVE', amount: 15000, category: 'Software' },
    ]));
    const cats = await s.getByCategory('u1');
    expect(cats['Streaming']).toBe(12980);
    expect(cats['Software']).toBe(15000);
  });
});
