const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { WhatPayPlatformStatsService } from '../../src/services/whatpay-platform-stats.service';

describe('WhatPayPlatformStatsService', () => {
  let s: WhatPayPlatformStatsService;
  beforeEach(() => { jest.clearAllMocks(); s = new WhatPayPlatformStatsService(); mockRedisGet.mockResolvedValue(null); });

  it('returns default stats', async () => {
    const stats = await s.getStats();
    expect(stats.countries).toContain('CL');
    expect(stats.availableCurrencies).toContain('CLP');
    expect(stats.apiVersion).toBe('v1');
  });

  it('returns stored stats', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ totalRegisteredUsers: 5000, apiVersion: 'v2' }));
    const stats = await s.getStats();
    expect(stats.totalRegisteredUsers).toBe(5000);
  });

  it('updates stats', async () => {
    const stats = await s.updateStats({ totalRegisteredUsers: 10000, servicesCount: 200 });
    expect(stats.totalRegisteredUsers).toBe(10000);
    expect(stats.servicesCount).toBe(200);
    expect(stats.updatedAt).toBeDefined();
  });

  it('preserves other fields on update', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ totalRegisteredUsers: 5000, apiVersion: 'v1', countries: ['CL', 'PE'] }));
    const stats = await s.updateStats({ totalRegisteredUsers: 6000 });
    expect(stats.apiVersion).toBe('v1');
    expect(stats.countries).toEqual(['CL', 'PE']);
  });

  it('formats platform summary', () => {
    const f = s.formatPlatformSummary({
      totalRegisteredUsers: 25000,
      totalActiveMerchants: 500,
      totalTransactionsAllTime: 100000,
      totalVolumeAllTime: 2500000000,
      countries: ['CL', 'PE'],
      availableCurrencies: ['CLP', 'USD'],
      apiVersion: 'v1',
      servicesCount: 180,
      testsCount: 3200,
      iterationsCount: 250,
      lastDeployAt: '',
      updatedAt: '',
    });
    expect(f).toContain('25.000');
    expect(f).toContain('$2.500.000.000');
    expect(f).toContain('CL, PE');
    expect(f).toContain('180');
    expect(f).toContain('3200');
  });
});
