/**
 * MerchantCustomersService — CRM basico para merchants.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { MerchantCustomersService } from '../../src/services/merchant-customers.service';

describe('MerchantCustomersService', () => {
  let service: MerchantCustomersService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MerchantCustomersService();
    mockRedisGet.mockResolvedValue(null);
  });

  it('adds a new customer', async () => {
    const c = await service.addOrUpdate('m1', '+569123', 5000, 'Juan');
    expect(c.id).toMatch(/^cust_/);
    expect(c.phone).toBe('+569123');
    expect(c.totalSpent).toBe(5000);
    expect(c.transactionCount).toBe(1);
  });

  it('updates existing customer', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'c1', merchantId: 'm1', phone: '+569123', name: 'Juan', totalSpent: 5000, transactionCount: 1, lastTransactionAt: null, tags: [] },
    ]));
    const c = await service.addOrUpdate('m1', '+569123', 3000);
    expect(c.totalSpent).toBe(8000);
    expect(c.transactionCount).toBe(2);
  });

  it('returns empty for new merchant', async () => {
    expect(await service.getCustomers('m1')).toEqual([]);
  });

  it('returns top customers by spent', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'c1', totalSpent: 10000 },
      { id: 'c2', totalSpent: 50000 },
      { id: 'c3', totalSpent: 30000 },
    ]));
    const top = await service.getTopCustomers('m1', 2);
    expect(top).toHaveLength(2);
    expect(top[0].totalSpent).toBe(50000);
    expect(top[1].totalSpent).toBe(30000);
  });

  it('returns recent customers', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'c1', lastTransactionAt: '2026-04-01' },
      { id: 'c2', lastTransactionAt: '2026-04-10' },
      { id: 'c3', lastTransactionAt: null },
    ]));
    const recent = await service.getRecentCustomers('m1');
    expect(recent).toHaveLength(2);
    expect(recent[0].id).toBe('c2');
  });

  it('adds tag to customer', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'c1', tags: [] },
    ]));
    expect(await service.addTag('m1', 'c1', 'VIP')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].tags).toContain('VIP');
  });

  it('rejects duplicate tag', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'c1', tags: ['VIP'] },
    ]));
    expect(await service.addTag('m1', 'c1', 'VIP')).toBe(true);
    expect(mockRedisSet).not.toHaveBeenCalled();
  });

  it('rejects over 10 tags', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'c1', tags: Array.from({ length: 10 }, (_, i) => `tag${i}`) },
    ]));
    expect(await service.addTag('m1', 'c1', 'extra')).toBe(false);
  });

  it('searches by name', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'c1', phone: '+569', name: 'Juan Perez', tags: [] },
      { id: 'c2', phone: '+568', name: 'Maria Lopez', tags: [] },
    ]));
    const results = await service.searchCustomers('m1', 'juan');
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Juan Perez');
  });

  it('searches by tag', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'c1', phone: '+569', name: null, tags: ['VIP', 'frecuente'] },
      { id: 'c2', phone: '+568', name: null, tags: ['nuevo'] },
    ]));
    const results = await service.searchCustomers('m1', 'vip');
    expect(results).toHaveLength(1);
  });

  it('counts customers', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]));
    expect(await service.getCustomerCount('m1')).toBe(3);
  });

  it('formats summary', () => {
    const summary = service.getCustomerSummary({
      id: 'c1', merchantId: 'm1', phone: '+569', name: 'Juan', email: null,
      totalSpent: 50000, transactionCount: 12, lastTransactionAt: null,
      firstSeenAt: '', tags: ['VIP'],
    });
    expect(summary).toContain('Juan');
    expect(summary).toContain('$50.000');
    expect(summary).toContain('12 tx');
    expect(summary).toContain('VIP');
  });
});
