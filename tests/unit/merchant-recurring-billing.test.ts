const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantRecurringBillingService } from '../../src/services/merchant-recurring-billing.service';

describe('MerchantRecurringBillingService', () => {
  let s: MerchantRecurringBillingService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantRecurringBillingService(); mockRedisGet.mockResolvedValue(null); });

  it('creates subscription', async () => {
    const sub = await s.createSubscription({ merchantId: 'm1', customerPhone: '+569', productName: 'Plan Premium', amount: 9990, frequency: 'MONTHLY' });
    expect(sub.id).toMatch(/^rsub_/);
    expect(sub.status).toBe('ACTIVE');
    expect(sub.failedAttempts).toBe(0);
  });

  it('rejects low amount', async () => {
    await expect(s.createSubscription({ merchantId: 'm1', customerPhone: '+569', productName: 'X', amount: 50, frequency: 'MONTHLY' })).rejects.toThrow('100');
  });

  it('rejects empty product', async () => {
    await expect(s.createSubscription({ merchantId: 'm1', customerPhone: '+569', productName: '', amount: 1000, frequency: 'MONTHLY' })).rejects.toThrow('Producto');
  });

  it('charges successfully and advances date', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'r1', status: 'ACTIVE', frequency: 'MONTHLY', failedAttempts: 2 }));
    const sub = await s.chargeSubscription('r1', true);
    expect(sub?.failedAttempts).toBe(0);
    expect(sub?.nextBillingDate).toBeDefined();
  });

  it('tracks failed attempts', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'r1', status: 'ACTIVE', frequency: 'MONTHLY', failedAttempts: 1 }));
    const sub = await s.chargeSubscription('r1', false);
    expect(sub?.failedAttempts).toBe(2);
  });

  it('marks PAST_DUE after 3 failures', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'r1', status: 'ACTIVE', frequency: 'MONTHLY', failedAttempts: 2 }));
    const sub = await s.chargeSubscription('r1', false);
    expect(sub?.status).toBe('PAST_DUE');
  });

  it('cancels subscription', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'r1', status: 'ACTIVE' }));
    expect(await s.cancelSubscription('r1')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.status).toBe('CANCELLED');
    expect(saved.cancelledAt).toBeDefined();
  });

  it('pauses active subscription', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'r1', status: 'ACTIVE' }));
    expect(await s.pauseSubscription('r1')).toBe(true);
  });

  it('cannot pause already cancelled', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'r1', status: 'CANCELLED' }));
    expect(await s.pauseSubscription('r1')).toBe(false);
  });

  it('formats subscription summary', () => {
    const f = s.formatSubSummary({ productName: 'Plan Premium', amount: 9990, frequency: 'MONTHLY', status: 'ACTIVE' } as any);
    expect(f).toContain('Plan Premium');
    expect(f).toContain('$9.990');
    expect(f).toContain('MONTHLY');
  });
});
