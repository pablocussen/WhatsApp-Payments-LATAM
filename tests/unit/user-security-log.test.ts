const mockRedisLPush = jest.fn().mockResolvedValue(1);
const mockRedisLTrim = jest.fn().mockResolvedValue('OK');
const mockRedisLRange = jest.fn().mockResolvedValue([]);
const mockRedisExpire = jest.fn().mockResolvedValue(true);
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ lPush: (...a: unknown[]) => mockRedisLPush(...a), lTrim: (...a: unknown[]) => mockRedisLTrim(...a), lRange: (...a: unknown[]) => mockRedisLRange(...a), expire: (...a: unknown[]) => mockRedisExpire(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserSecurityLogService } from '../../src/services/user-security-log.service';

describe('UserSecurityLogService', () => {
  let s: UserSecurityLogService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserSecurityLogService(); mockRedisLRange.mockResolvedValue([]); });

  it('logs event', async () => { const e = await s.logEvent({ userId: 'u1', event: 'LOGIN', ipAddress: '1.2.3.4', userAgent: 'Chrome', details: 'Login exitoso', riskLevel: 'LOW' }); expect(e.id).toMatch(/^seclog_/); });
  it('returns empty', async () => { expect(await s.getLogs('u1')).toEqual([]); });
  it('filters high risk', async () => {
    mockRedisLRange.mockResolvedValue([JSON.stringify({ riskLevel: 'LOW' }), JSON.stringify({ riskLevel: 'HIGH' }), JSON.stringify({ riskLevel: 'MEDIUM' })]);
    expect(await s.getHighRiskEvents('u1')).toHaveLength(1);
  });
  it('counts login attempts', async () => {
    const recent = new Date().toISOString();
    mockRedisLRange.mockResolvedValue([
      JSON.stringify({ event: 'LOGIN', timestamp: recent }),
      JSON.stringify({ event: 'LOGIN_FAILED', timestamp: recent }),
      JSON.stringify({ event: 'LOGIN_FAILED', timestamp: recent }),
      JSON.stringify({ event: 'PIN_CHANGED', timestamp: recent }),
    ]);
    const r = await s.getRecentLoginAttempts('u1');
    expect(r.success).toBe(1); expect(r.failed).toBe(2);
  });
});
