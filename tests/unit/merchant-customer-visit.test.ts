const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantCustomerVisitService } from '../../src/services/merchant-customer-visit.service';

describe('MerchantCustomerVisitService', () => {
  let s: MerchantCustomerVisitService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantCustomerVisitService(); mockRedisGet.mockResolvedValue(null); });

  const base = {
    merchantId: 'm1',
    customerId: 'c1',
    customerName: 'Pablo',
    amountSpent: 25000,
    itemsPurchased: 3,
    source: 'WALK_IN' as const,
  };

  it('records visit', async () => {
    const v = await s.recordVisit(base);
    expect(v.id).toMatch(/^visit_/);
    expect(v.amountSpent).toBe(25000);
  });

  it('rejects negative amount', async () => {
    await expect(s.recordVisit({ ...base, amountSpent: -100 })).rejects.toThrow('Monto');
  });

  it('rejects negative items', async () => {
    await expect(s.recordVisit({ ...base, itemsPurchased: -1 })).rejects.toThrow('Items');
  });

  it('returns customer history sorted desc', async () => {
    const older = new Date(Date.now() - 86400000).toISOString();
    const newer = new Date().toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { customerId: 'c1', visitedAt: older, amountSpent: 1000, customerName: 'x' },
      { customerId: 'c1', visitedAt: newer, amountSpent: 2000, customerName: 'x' },
      { customerId: 'c2', visitedAt: newer, amountSpent: 500, customerName: 'y' },
    ]));
    const h = await s.getCustomerHistory('m1', 'c1');
    expect(h).toHaveLength(2);
    expect(h[0].visitedAt).toBe(newer);
  });

  it('returns null summary for unknown customer', async () => {
    expect(await s.getCustomerSummary('m1', 'c1')).toBeNull();
  });

  it('computes customer summary', async () => {
    const d1 = new Date(Date.now() - 10 * 86400000).toISOString();
    const d2 = new Date(Date.now() - 5 * 86400000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { customerId: 'c1', customerName: 'Pablo', visitedAt: d1, amountSpent: 10000 },
      { customerId: 'c1', customerName: 'Pablo', visitedAt: d2, amountSpent: 20000 },
    ]));
    const sum = await s.getCustomerSummary('m1', 'c1');
    expect(sum?.visitCount).toBe(2);
    expect(sum?.totalSpent).toBe(30000);
    expect(sum?.averageTicket).toBe(15000);
    expect(sum?.daysSinceLastVisit).toBeGreaterThanOrEqual(4);
  });

  it('returns top customers sorted by spent', async () => {
    const now = new Date().toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { customerId: 'c1', customerName: 'A', visitedAt: now, amountSpent: 5000 },
      { customerId: 'c2', customerName: 'B', visitedAt: now, amountSpent: 50000 },
      { customerId: 'c3', customerName: 'C', visitedAt: now, amountSpent: 15000 },
    ]));
    const top = await s.getTopCustomers('m1', 2);
    expect(top[0].customerId).toBe('c2');
    expect(top[1].customerId).toBe('c3');
  });

  it('returns lapsed customers beyond threshold', async () => {
    const old = new Date(Date.now() - 60 * 86400000).toISOString();
    const recent = new Date().toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { customerId: 'c1', customerName: 'A', visitedAt: old, amountSpent: 1000 },
      { customerId: 'c2', customerName: 'B', visitedAt: recent, amountSpent: 1000 },
    ]));
    const lapsed = await s.getLapsed('m1', 30);
    expect(lapsed).toHaveLength(1);
    expect(lapsed[0].customerId).toBe('c1');
  });

  it('groups by source in window', async () => {
    const recent = new Date().toISOString();
    const old = new Date(Date.now() - 100 * 86400000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { source: 'WALK_IN', visitedAt: recent },
      { source: 'QR_SCAN', visitedAt: recent },
      { source: 'QR_SCAN', visitedAt: recent },
      { source: 'ORDER', visitedAt: old },
    ]));
    const counts = await s.getBySource('m1', 30);
    expect(counts.WALK_IN).toBe(1);
    expect(counts.QR_SCAN).toBe(2);
    expect(counts.ORDER).toBe(0);
  });
});
