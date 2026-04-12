const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantWaitingListService } from '../../src/services/merchant-waiting-list.service';

describe('MerchantWaitingListService', () => {
  let s: MerchantWaitingListService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantWaitingListService(); mockRedisGet.mockResolvedValue(null); });

  it('adds to waitlist', async () => {
    const e = await s.addToWaitlist({ merchantId: 'm1', customerPhone: '+569', productId: 'p1', productName: 'iPhone' });
    expect(e.position).toBe(1);
    expect(e.status).toBe('WAITING');
  });

  it('assigns correct position', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'e1', status: 'WAITING', customerPhone: '+569A' },
      { id: 'e2', status: 'WAITING', customerPhone: '+569B' },
    ]));
    const e = await s.addToWaitlist({ merchantId: 'm1', customerPhone: '+569C', productId: 'p1', productName: 'X' });
    expect(e.position).toBe(3);
  });

  it('rejects duplicate', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ customerPhone: '+569', status: 'WAITING' }]));
    await expect(s.addToWaitlist({ merchantId: 'm1', customerPhone: '+569', productId: 'p1', productName: 'X' })).rejects.toThrow('Ya estas');
  });

  it('notifies next in line', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'e1', status: 'WAITING' },
      { id: 'e2', status: 'WAITING' },
      { id: 'e3', status: 'WAITING' },
    ]));
    const notified = await s.notifyNext('m1', 'p1', 2);
    expect(notified).toHaveLength(2);
  });

  it('marks converted', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'e1', status: 'NOTIFIED' }]));
    expect(await s.markConverted('m1', 'p1', 'e1')).toBe(true);
  });

  it('cancels entry', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'e1', status: 'WAITING' }]));
    expect(await s.cancelEntry('m1', 'p1', 'e1')).toBe(true);
  });

  it('returns stats', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'WAITING' }, { status: 'WAITING' },
      { status: 'NOTIFIED' },
      { status: 'CONVERTED' },
    ]));
    const stats = await s.getStats('m1', 'p1');
    expect(stats.waiting).toBe(2);
    expect(stats.notified).toBe(1);
    expect(stats.converted).toBe(1);
  });
});
