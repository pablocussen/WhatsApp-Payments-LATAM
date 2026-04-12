const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantOrderStatusService } from '../../src/services/merchant-order-status.service';

describe('MerchantOrderStatusService', () => {
  let s: MerchantOrderStatusService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantOrderStatusService(); mockRedisGet.mockResolvedValue(null); });

  it('creates order', async () => {
    const o = await s.createOrder({ orderId: 'ord1', merchantId: 'm1', customerPhone: '+569' });
    expect(o.currentStatus).toBe('PENDING');
    expect(o.history).toHaveLength(1);
  });

  it('transitions PENDING -> CONFIRMED', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ orderId: 'ord1', currentStatus: 'PENDING', history: [] }));
    const r = await s.updateStatus('ord1', 'CONFIRMED', 'admin');
    expect(r.success).toBe(true);
  });

  it('rejects invalid transition', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ orderId: 'ord1', currentStatus: 'PENDING', history: [] }));
    const r = await s.updateStatus('ord1', 'DELIVERED', 'admin');
    expect(r.success).toBe(false);
    expect(r.error).toContain('invalida');
  });

  it('transitions READY -> OUT_FOR_DELIVERY -> DELIVERED', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ orderId: 'ord1', currentStatus: 'READY', history: [] }));
    expect((await s.updateStatus('ord1', 'OUT_FOR_DELIVERY', 'admin')).success).toBe(true);
  });

  it('allows cancellation from pending', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ orderId: 'ord1', currentStatus: 'PENDING', history: [] }));
    expect((await s.updateStatus('ord1', 'CANCELLED', 'admin')).success).toBe(true);
  });

  it('rejects update on missing order', async () => {
    const r = await s.updateStatus('nope', 'CONFIRMED', 'admin');
    expect(r.success).toBe(false);
  });

  it('detects terminal states', () => {
    expect(s.isTerminal('DELIVERED')).toBe(true);
    expect(s.isTerminal('CANCELLED')).toBe(true);
    expect(s.isTerminal('PENDING')).toBe(false);
  });

  it('returns allowed transitions', () => {
    expect(s.getAllowedTransitions('PENDING')).toEqual(['CONFIRMED', 'CANCELLED']);
    expect(s.getAllowedTransitions('DELIVERED')).toEqual([]);
  });
});
