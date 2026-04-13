const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserRoundUpSavingsService } from '../../src/services/user-round-up-savings.service';

describe('UserRoundUpSavingsService', () => {
  let s: UserRoundUpSavingsService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserRoundUpSavingsService(); mockRedisGet.mockResolvedValue(null); });

  it('returns default disabled config', async () => {
    const c = await s.getConfig('u1');
    expect(c.enabled).toBe(false);
    expect(c.mode).toBe('NEAREST_100');
  });

  it('enables round up', async () => {
    const c = await s.enable('u1', 'NEAREST_500', 'acc1');
    expect(c.enabled).toBe(true);
    expect(c.targetAccountId).toBe('acc1');
  });

  it('rejects enable without account', async () => {
    await expect(s.enable('u1', 'NEAREST_100', '')).rejects.toThrow('destino');
  });

  it('disables', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ userId: 'u1', enabled: true, mode: 'NEAREST_100', targetAccountId: 'a1', totalSaved: 0, transactionCount: 0, updatedAt: '' }));
    const c = await s.disable('u1');
    expect(c.enabled).toBe(false);
  });

  it('computes round up to 100', () => {
    expect(s.computeRoundUp(2340, 'NEAREST_100')).toBe(60);
    expect(s.computeRoundUp(2300, 'NEAREST_100')).toBe(0);
  });

  it('computes round up to 500', () => {
    expect(s.computeRoundUp(2340, 'NEAREST_500')).toBe(160);
  });

  it('computes round up to 1000', () => {
    expect(s.computeRoundUp(2340, 'NEAREST_1000')).toBe(660);
  });

  it('records transaction and saves round up', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ userId: 'u1', enabled: true, mode: 'NEAREST_100', targetAccountId: 'a1', totalSaved: 500, transactionCount: 3, updatedAt: '' }));
    const r = await s.recordTransaction('u1', 2340);
    expect(r?.roundUp).toBe(60);
    expect(r?.totalSaved).toBe(560);
  });

  it('returns null when disabled', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ userId: 'u1', enabled: false, mode: 'NEAREST_100', targetAccountId: '', totalSaved: 0, transactionCount: 0, updatedAt: '' }));
    expect(await s.recordTransaction('u1', 1000)).toBeNull();
  });

  it('resets totals', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ userId: 'u1', enabled: true, mode: 'NEAREST_100', targetAccountId: 'a1', totalSaved: 5000, transactionCount: 10, updatedAt: '' }));
    const c = await s.reset('u1');
    expect(c.totalSaved).toBe(0);
    expect(c.transactionCount).toBe(0);
  });

  it('formats summary', () => {
    const f = s.formatSummary({ userId: 'u1', enabled: true, mode: 'NEAREST_500', targetAccountId: 'a1', totalSaved: 12500, transactionCount: 25, updatedAt: '' });
    expect(f).toContain('ON');
    expect(f).toContain('500');
    expect(f).toContain('12.500');
  });
});
