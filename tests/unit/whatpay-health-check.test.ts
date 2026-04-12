const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { WhatPayHealthCheckService } from '../../src/services/whatpay-health-check.service';

describe('WhatPayHealthCheckService', () => {
  let s: WhatPayHealthCheckService;
  beforeEach(() => { jest.clearAllMocks(); s = new WhatPayHealthCheckService(); mockRedisGet.mockResolvedValue(null); });

  it('records operational check', async () => {
    const h = await s.recordCheck('api', 'OPERATIONAL', 120);
    expect(h.status).toBe('OPERATIONAL');
    expect(h.responseMs).toBe(120);
  });

  it('records outage with message', async () => {
    const h = await s.recordCheck('redis', 'OUTAGE', 5000, 'Connection timeout');
    expect(h.status).toBe('OUTAGE');
    expect(h.message).toBe('Connection timeout');
  });

  it('returns null for missing service', async () => {
    expect(await s.getServiceHealth('unknown')).toBeNull();
  });

  it('returns OPERATIONAL platform when all ok', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      return Promise.resolve(JSON.stringify({ name: key, status: 'OPERATIONAL', responseMs: 100, lastCheckedAt: '', message: null }));
    });
    const p = await s.getPlatformHealth(['api', 'redis', 'db']);
    expect(p.overallStatus).toBe('OPERATIONAL');
    expect(p.uptime).toBe(100);
  });

  it('returns DEGRADED when one service degraded', async () => {
    const data: Record<string, string> = {
      'healthchk:api': JSON.stringify({ name: 'api', status: 'OPERATIONAL', responseMs: 100, lastCheckedAt: '', message: null }),
      'healthchk:redis': JSON.stringify({ name: 'redis', status: 'DEGRADED', responseMs: 500, lastCheckedAt: '', message: null }),
    };
    mockRedisGet.mockImplementation((key: string) => Promise.resolve(data[key] ?? null));
    const p = await s.getPlatformHealth(['api', 'redis']);
    expect(p.overallStatus).toBe('DEGRADED');
  });

  it('returns OUTAGE when one service down', async () => {
    const data: Record<string, string> = {
      'healthchk:api': JSON.stringify({ name: 'api', status: 'OPERATIONAL', responseMs: 100, lastCheckedAt: '', message: null }),
      'healthchk:db': JSON.stringify({ name: 'db', status: 'OUTAGE', responseMs: 0, lastCheckedAt: '', message: 'down' }),
    };
    mockRedisGet.mockImplementation((key: string) => Promise.resolve(data[key] ?? null));
    const p = await s.getPlatformHealth(['api', 'db']);
    expect(p.overallStatus).toBe('OUTAGE');
    expect(p.uptime).toBe(50);
  });

  it('runs full check', async () => {
    const r = await s.runFullCheck();
    expect(r.api).toBe(true);
    expect(r.redis).toBe(true);
    expect(r.database).toBe(true);
  });
});
