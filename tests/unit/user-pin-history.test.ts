const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserPINHistoryService } from '../../src/services/user-pin-history.service';

describe('UserPINHistoryService', () => {
  let s: UserPINHistoryService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserPINHistoryService(); mockRedisGet.mockResolvedValue(null); });

  it('records PIN change', async () => {
    await s.recordPINChange('u1', '123456');
    expect(mockRedisSet).toHaveBeenCalled();
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved).toHaveLength(1);
    expect(saved[0].hashedPin).toHaveLength(64);
  });

  it('trims to 5 entries', async () => {
    const existing = Array.from({ length: 5 }, (_, i) => ({ hashedPin: `hash${i}`, changedAt: '2026-01-01' }));
    mockRedisGet.mockResolvedValue(JSON.stringify(existing));
    await s.recordPINChange('u1', '999999');
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved).toHaveLength(5);
  });

  it('detects reused PIN', async () => {
    await s.recordPINChange('u1', '123456');
    const hash = JSON.parse(mockRedisSet.mock.calls[0][1])[0].hashedPin;
    mockRedisGet.mockResolvedValue(JSON.stringify([{ hashedPin: hash, changedAt: '2026-01-01' }]));
    expect(await s.wasUsedBefore('u1', '123456')).toBe(true);
  });

  it('detects new PIN', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ hashedPin: 'different-hash', changedAt: '2026-01-01' }]));
    expect(await s.wasUsedBefore('u1', '999999')).toBe(false);
  });

  it('returns empty history for new user', async () => {
    expect(await s.getHistory('u1')).toEqual([]);
  });

  it('returns last change date', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ hashedPin: 'h', changedAt: '2026-04-10T12:00:00Z' }]));
    expect(await s.getLastChange('u1')).toBe('2026-04-10T12:00:00Z');
  });

  it('returns null when no history', async () => {
    expect(await s.getLastChange('u1')).toBeNull();
  });

  it('calculates days since last change', async () => {
    const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([{ hashedPin: 'h', changedAt: past }]));
    const days = await s.daysSinceLastChange('u1');
    expect(days).toBeGreaterThanOrEqual(9);
    expect(days).toBeLessThanOrEqual(11);
  });

  it('returns Infinity when no history', async () => {
    expect(await s.daysSinceLastChange('u1')).toBe(Infinity);
  });
});
