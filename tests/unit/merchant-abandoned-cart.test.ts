const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantAbandonedCartService } from '../../src/services/merchant-abandoned-cart.service';

describe('MerchantAbandonedCartService', () => {
  let s: MerchantAbandonedCartService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantAbandonedCartService(); mockRedisGet.mockResolvedValue(null); });

  it('saves cart', async () => {
    const c = await s.saveCart({ merchantId: 'm1', customerPhone: '+569', items: [{ name: 'Cafe', quantity: 2, price: 3000 }] });
    expect(c.id).toMatch(/^cart_/);
    expect(c.totalAmount).toBe(6000);
    expect(c.status).toBe('ACTIVE');
  });

  it('rejects empty cart', async () => {
    await expect(s.saveCart({ merchantId: 'm1', customerPhone: '+569', items: [] })).rejects.toThrow('items');
  });

  it('marks abandoned', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'c1', status: 'ACTIVE' }));
    expect(await s.markAbandoned('c1')).toBe(true);
  });

  it('marks recovered', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'c1', status: 'ABANDONED', totalAmount: 5000 }));
    expect(await s.markRecovered('c1')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.status).toBe('RECOVERED');
    expect(saved.recoveredAt).toBeDefined();
  });

  it('increments reminder counter', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'c1', remindersSent: 1 }));
    expect(await s.incrementReminder('c1')).toBe(true);
    expect(JSON.parse(mockRedisSet.mock.calls[0][1]).remindersSent).toBe(2);
  });

  it('blocks over 3 reminders', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'c1', remindersSent: 3 }));
    expect(await s.incrementReminder('c1')).toBe(false);
  });

  it('formats summary', () => {
    const f = s.formatCartSummary({ id: 'c1', totalAmount: 50000, items: [{}, {}], status: 'ABANDONED', remindersSent: 2 } as any);
    expect(f).toContain('$50.000');
    expect(f).toContain('ABANDONED');
  });
});
