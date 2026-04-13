const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantDeliveryDispatchService } from '../../src/services/merchant-delivery-dispatch.service';

describe('MerchantDeliveryDispatchService', () => {
  let s: MerchantDeliveryDispatchService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantDeliveryDispatchService(); mockRedisGet.mockResolvedValue(null); });

  const base = {
    merchantId: 'm1',
    orderId: 'o1',
    customerName: 'Juan',
    customerPhone: '+56912345678',
    address: 'Av. Siempre Viva 742',
    amount: 25000,
  };

  it('creates dispatch', async () => {
    const d = await s.createDispatch(base);
    expect(d.status).toBe('PENDING');
  });

  it('rejects invalid phone', async () => {
    await expect(s.createDispatch({ ...base, customerPhone: 'xyz' })).rejects.toThrow('Telefono');
  });

  it('rejects short address', async () => {
    await expect(s.createDispatch({ ...base, address: 'abc' })).rejects.toThrow('5 y 200');
  });

  it('rejects duplicate active order', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ orderId: 'o1', status: 'PENDING' }]));
    await expect(s.createDispatch(base)).rejects.toThrow('dispatch activo');
  });

  it('allows new dispatch after cancelled', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ orderId: 'o1', status: 'CANCELLED' }]));
    const d = await s.createDispatch(base);
    expect(d.status).toBe('PENDING');
  });

  it('assigns courier', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1', status: 'PENDING' }]));
    const d = await s.assignCourier('m1', 'd1', 'c1', 'Pedro');
    expect(d?.status).toBe('ASSIGNED');
    expect(d?.courierName).toBe('Pedro');
  });

  it('rejects assign if not pending', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1', status: 'IN_TRANSIT' }]));
    await expect(s.assignCourier('m1', 'd1', 'c1', 'x')).rejects.toThrow('estado actual');
  });

  it('marks in transit', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1', status: 'ASSIGNED' }]));
    const d = await s.markInTransit('m1', 'd1');
    expect(d?.status).toBe('IN_TRANSIT');
    expect(d?.pickedUpAt).toBeDefined();
  });

  it('marks delivered with proof', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1', status: 'IN_TRANSIT' }]));
    const d = await s.markDelivered('m1', 'd1', 'https://proof.jpg');
    expect(d?.status).toBe('DELIVERED');
    expect(d?.proofImageUrl).toBe('https://proof.jpg');
  });

  it('marks failed with reason', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1', status: 'IN_TRANSIT' }]));
    const d = await s.markFailed('m1', 'd1', 'Cliente ausente');
    expect(d?.status).toBe('FAILED');
    expect(d?.failureReason).toBe('Cliente ausente');
  });

  it('rejects fail on delivered', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1', status: 'DELIVERED' }]));
    await expect(s.markFailed('m1', 'd1', 'x')).rejects.toThrow('finalizado');
  });

  it('counts courier load', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { courierId: 'c1', status: 'ASSIGNED' },
      { courierId: 'c1', status: 'IN_TRANSIT' },
      { courierId: 'c1', status: 'DELIVERED' },
      { courierId: 'c2', status: 'ASSIGNED' },
    ]));
    expect(await s.getCourierLoad('m1', 'c1')).toBe(2);
  });

  it('computes delivery stats', async () => {
    const assigned = new Date(Date.now() - 30 * 60000).toISOString();
    const delivered = new Date().toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'DELIVERED', assignedAt: assigned, deliveredAt: delivered },
      { status: 'DELIVERED', assignedAt: assigned, deliveredAt: delivered },
      { status: 'FAILED' },
      { status: 'PENDING' },
    ]));
    const stats = await s.getDeliveryStats('m1');
    expect(stats.total).toBe(4);
    expect(stats.delivered).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.successRate).toBe(50);
    expect(stats.avgDeliveryMinutes).toBe(30);
  });
});
