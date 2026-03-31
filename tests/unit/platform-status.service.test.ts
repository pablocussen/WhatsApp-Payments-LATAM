/**
 * Unit tests for platform-status.service.ts
 */

const mockRedisGet = jest.fn();
const mockRedisMulti = jest.fn();

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    multi: () => mockRedisMulti(),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { platformStatus } from '../../src/services/platform-status.service';

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisGet.mockResolvedValue(null);
  mockRedisMulti.mockReturnValue({
    incr: jest.fn().mockReturnThis(),
    incrBy: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([1, true, 1, true, 1, true]),
  });
});

describe('recordRequest', () => {
  it('records without throwing', async () => {
    await expect(platformStatus.recordRequest('GET', 200, 15)).resolves.toBeUndefined();
  });

  it('handles Redis error gracefully', async () => {
    mockRedisMulti.mockReturnValue({
      incr: jest.fn().mockReturnThis(),
      incrBy: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockRejectedValue(new Error('Redis down')),
    });
    await expect(platformStatus.recordRequest('POST', 500, 100)).resolves.toBeUndefined();
  });
});

describe('getMetrics', () => {
  it('returns zeros when no data', async () => {
    const metrics = await platformStatus.getMetrics();
    expect(metrics.totalRequests).toBe(0);
    expect(metrics.avgLatencyMs).toBe(0);
    expect(metrics.errorsLastHour).toBe(0);
  });

  it('returns parsed metrics from Redis', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.includes('total:')) return Promise.resolve('100');
      if (key.includes('latency:sum:')) return Promise.resolve('5000');
      if (key.includes('latency:count:')) return Promise.resolve('100');
      if (key.includes('errors:')) return Promise.resolve('3');
      if (key.includes('method:GET:')) return Promise.resolve('80');
      if (key.includes('method:POST:')) return Promise.resolve('20');
      if (key.includes('status:2xx:')) return Promise.resolve('95');
      if (key.includes('status:4xx:')) return Promise.resolve('5');
      return Promise.resolve(null);
    });

    const metrics = await platformStatus.getMetrics();
    expect(metrics.totalRequests).toBe(100);
    expect(metrics.avgLatencyMs).toBe(50);
    expect(metrics.errorsLastHour).toBe(3);
    expect(metrics.byMethod.GET).toBe(80);
    expect(metrics.byMethod.POST).toBe(20);
    expect(metrics.byStatus['2xx']).toBe(95);
  });
});

describe('getPlatformInfo', () => {
  it('returns operational status', () => {
    const info = platformStatus.getPlatformInfo(new Date());
    expect(info.status).toBe('operational');
    expect(info.services.api).toBe('up');
    expect(info.metrics.totalServices).toBe(44);
  });

  it('calculates uptime correctly', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600000);
    const info = platformStatus.getPlatformInfo(twoHoursAgo);
    expect(info.metrics.uptime).toMatch(/2h 0m/);
  });
});
