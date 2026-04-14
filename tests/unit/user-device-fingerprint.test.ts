const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserDeviceFingerprintService } from '../../src/services/user-device-fingerprint.service';

describe('UserDeviceFingerprintService', () => {
  let s: UserDeviceFingerprintService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserDeviceFingerprintService(); mockRedisGet.mockResolvedValue(null); });

  const base = {
    userId: 'u1',
    userAgent: 'Mozilla/5.0 (iPhone) AppleWebKit/605',
    platform: 'iOS',
    ipAddress: '190.160.1.1',
  };

  it('registers new device as UNKNOWN', async () => {
    const d = await s.registerOrUpdate(base);
    expect(d.trustLevel).toBe('UNKNOWN');
    expect(d.sessionCount).toBe(1);
    expect(d.fingerprintHash).toHaveLength(32);
  });

  it('rejects missing IP', async () => {
    await expect(s.registerOrUpdate({ ...base, ipAddress: '' })).rejects.toThrow('IP');
  });

  it('updates existing device on second visit', async () => {
    mockRedisGet.mockResolvedValue(null);
    const first = await s.registerOrUpdate(base);
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      ...first, sessionCount: 1, trustLevel: 'UNKNOWN',
    }]));
    const second = await s.registerOrUpdate(base);
    expect(second.sessionCount).toBe(2);
  });

  it('promotes to RECOGNIZED after 3 sessions', async () => {
    const first = s['hashComponents'](base);
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'd1', fingerprintHash: first, sessionCount: 2, trustLevel: 'UNKNOWN',
      firstSeenAt: '', lastSeenAt: '', userAgent: base.userAgent, platform: base.platform, ipAddress: base.ipAddress, userId: 'u1',
    }]));
    const d = await s.registerOrUpdate(base);
    expect(d.trustLevel).toBe('RECOGNIZED');
  });

  it('rejects blocked device', async () => {
    const hash = s['hashComponents'](base);
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'd1', fingerprintHash: hash, trustLevel: 'BLOCKED',
      userAgent: base.userAgent, platform: base.platform,
    }]));
    await expect(s.registerOrUpdate(base)).rejects.toThrow('bloqueado');
  });

  it('trusts device', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1', trustLevel: 'RECOGNIZED' }]));
    const d = await s.trust('u1', 'd1');
    expect(d?.trustLevel).toBe('TRUSTED');
  });

  it('rejects trust on blocked', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1', trustLevel: 'BLOCKED' }]));
    await expect(s.trust('u1', 'd1')).rejects.toThrow('bloqueado');
  });

  it('blocks device with reason', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1', trustLevel: 'RECOGNIZED' }]));
    const d = await s.block('u1', 'd1', 'Sospechoso');
    expect(d?.trustLevel).toBe('BLOCKED');
    expect(d?.blockedReason).toBe('Sospechoso');
  });

  it('removes device', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1' }, { id: 'd2' }]));
    expect(await s.remove('u1', 'd1')).toBe(true);
  });

  it('detects new device', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([]));
    expect(await s.isNewDevice('u1', 'New UA', 'Linux')).toBe(true);
  });

  it('detects known device', async () => {
    const hash = s['hashComponents']({ userAgent: base.userAgent, platform: base.platform });
    mockRedisGet.mockResolvedValue(JSON.stringify([{ fingerprintHash: hash }]));
    expect(await s.isNewDevice('u1', base.userAgent, base.platform)).toBe(false);
  });

  it('counts trusted devices', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { trustLevel: 'TRUSTED' }, { trustLevel: 'TRUSTED' }, { trustLevel: 'RECOGNIZED' },
    ]));
    expect(await s.getTrustedCount('u1')).toBe(2);
  });

  it('returns recently active sorted desc', async () => {
    const recent = new Date(Date.now() - 86400000).toISOString();
    const old = new Date(Date.now() - 60 * 86400000).toISOString();
    const newer = new Date().toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'd1', lastSeenAt: recent },
      { id: 'd2', lastSeenAt: old },
      { id: 'd3', lastSeenAt: newer },
    ]));
    const active = await s.getRecentlyActive('u1', 7);
    expect(active).toHaveLength(2);
    expect(active[0].id).toBe('d3');
  });
});
