const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserAutoTopupService } from '../../src/services/user-auto-topup.service';

describe('UserAutoTopupService', () => {
  let s: UserAutoTopupService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserAutoTopupService(); mockRedisGet.mockResolvedValue(null); });

  const base = {
    userId: 'u1',
    triggerType: 'LOW_BALANCE' as const,
    minBalanceTrigger: 5000,
    topupAmount: 20000,
    sourceAccountId: 'acc1',
  };

  it('configures auto topup', async () => {
    const c = await s.configure(base);
    expect(c.status).toBe('ACTIVE');
    expect(c.maxPerMonth).toBe(10);
  });

  it('rejects amount out of range', async () => {
    await expect(s.configure({ ...base, topupAmount: 1000 })).rejects.toThrow('5.000');
    await expect(s.configure({ ...base, topupAmount: 1000000 })).rejects.toThrow('500.000');
  });

  it('rejects missing source account', async () => {
    await expect(s.configure({ ...base, sourceAccountId: '' })).rejects.toThrow('Cuenta');
  });

  it('rejects invalid max per month', async () => {
    await expect(s.configure({ ...base, maxPerMonth: 50 })).rejects.toThrow('1 y 30');
  });

  it('pauses active config', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ ...base, status: 'ACTIVE', enabled: true, usedThisMonth: 0, maxPerMonth: 10, createdAt: '', updatedAt: '' }));
    const c = await s.pause('u1');
    expect(c?.status).toBe('PAUSED');
  });

  it('resumes paused config', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ ...base, status: 'PAUSED', enabled: false, usedThisMonth: 0, maxPerMonth: 10, createdAt: '', updatedAt: '' }));
    const c = await s.resume('u1');
    expect(c?.status).toBe('ACTIVE');
    expect(c?.enabled).toBe(true);
  });

  it('disables config', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ ...base, status: 'ACTIVE', enabled: true, usedThisMonth: 0, maxPerMonth: 10, createdAt: '', updatedAt: '' }));
    const c = await s.disable('u1');
    expect(c?.status).toBe('DISABLED');
  });

  it('triggers on low balance', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ ...base, status: 'ACTIVE', enabled: true, usedThisMonth: 0, maxPerMonth: 10, createdAt: '', updatedAt: '' }));
    expect(await s.shouldTrigger('u1', 3000)).toBe(true);
    mockRedisGet.mockResolvedValue(JSON.stringify({ ...base, status: 'ACTIVE', enabled: true, usedThisMonth: 0, maxPerMonth: 10, createdAt: '', updatedAt: '' }));
    expect(await s.shouldTrigger('u1', 10000)).toBe(false);
  });

  it('does not trigger when paused', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ ...base, status: 'PAUSED', enabled: true, usedThisMonth: 0, maxPerMonth: 10, createdAt: '', updatedAt: '' }));
    expect(await s.shouldTrigger('u1', 100)).toBe(false);
  });

  it('does not trigger when max reached', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ ...base, status: 'ACTIVE', enabled: true, usedThisMonth: 10, maxPerMonth: 10, createdAt: '', updatedAt: '' }));
    expect(await s.shouldTrigger('u1', 100)).toBe(false);
  });

  it('records topup and increments counter', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ ...base, status: 'ACTIVE', enabled: true, usedThisMonth: 2, maxPerMonth: 10, createdAt: '', updatedAt: '' }));
    const c = await s.recordTopup('u1');
    expect(c?.usedThisMonth).toBe(3);
    expect(c?.lastTopupAt).toBeDefined();
  });

  it('rejects topup when limit reached', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ ...base, status: 'ACTIVE', enabled: true, usedThisMonth: 10, maxPerMonth: 10, createdAt: '', updatedAt: '' }));
    await expect(s.recordTopup('u1')).rejects.toThrow('Limite mensual');
  });

  it('resets monthly usage', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ ...base, status: 'ACTIVE', enabled: true, usedThisMonth: 7, maxPerMonth: 10, createdAt: '', updatedAt: '' }));
    const c = await s.resetMonthlyUsage('u1');
    expect(c?.usedThisMonth).toBe(0);
  });
});
