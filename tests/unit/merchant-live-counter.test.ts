const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantLiveCounterService } from '../../src/services/merchant-live-counter.service';

describe('MerchantLiveCounterService', () => {
  let s: MerchantLiveCounterService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantLiveCounterService(); mockRedisGet.mockResolvedValue(null); });

  it('increments transaction', async () => {
    const c = await s.incrementTransaction('m1', 5000);
    expect(c.todayTransactions).toBe(1);
    expect(c.todayRevenue).toBe(5000);
    expect(c.lastTransactionAt).toBeDefined();
  });

  it('accumulates transactions', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ merchantId: 'm1', todayTransactions: 5, todayRevenue: 25000, activeCustomersNow: 0, lastTransactionAt: null, updatedAt: '' }));
    const c = await s.incrementTransaction('m1', 3000);
    expect(c.todayTransactions).toBe(6);
    expect(c.todayRevenue).toBe(28000);
  });

  it('sets active customers', async () => {
    await s.setActiveCustomers('m1', 15);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.activeCustomersNow).toBe(15);
  });

  it('returns defaults for new merchant', async () => {
    const c = await s.getCounter('m1');
    expect(c.todayTransactions).toBe(0);
    expect(c.activeCustomersNow).toBe(0);
  });

  it('resets daily counts', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ merchantId: 'm1', todayTransactions: 50, todayRevenue: 500000, activeCustomersNow: 10, lastTransactionAt: '', updatedAt: '' }));
    await s.resetDaily('m1');
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.todayTransactions).toBe(0);
    expect(saved.todayRevenue).toBe(0);
  });

  it('formats live summary', () => {
    const f = s.formatLiveSummary({ merchantId: 'm1', todayTransactions: 25, todayRevenue: 250000, activeCustomersNow: 8, lastTransactionAt: '', updatedAt: '' });
    expect(f).toContain('25 tx');
    expect(f).toContain('$250.000');
    expect(f).toContain('$10.000');
    expect(f).toContain('8');
  });

  it('handles zero transactions in avg', () => {
    const f = s.formatLiveSummary({ merchantId: 'm1', todayTransactions: 0, todayRevenue: 0, activeCustomersNow: 0, lastTransactionAt: '', updatedAt: '' });
    expect(f).toContain('$0');
  });
});
