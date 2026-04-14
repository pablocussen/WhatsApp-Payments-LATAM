const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantOrderFulfillmentService } from '../../src/services/merchant-order-fulfillment.service';

describe('MerchantOrderFulfillmentService', () => {
  let s: MerchantOrderFulfillmentService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantOrderFulfillmentService(); mockRedisGet.mockResolvedValue(null); });

  const base = {
    merchantId: 'm1',
    customerId: 'c1',
    customerName: 'Pablo',
    items: [
      { sku: 'P1', name: 'Cafe', quantity: 2, unitPrice: 2500 },
      { sku: 'P2', name: 'Torta', quantity: 1, unitPrice: 5000 },
    ],
    estimatedMinutes: 15,
  };

  it('receives order with calculated total', async () => {
    const o = await s.receive(base);
    expect(o.totalAmount).toBe(10000);
    expect(o.status).toBe('RECEIVED');
    expect(o.orderNumber).toBe(1);
  });

  it('increments order number', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ orderNumber: 5 }, { orderNumber: 7 }]));
    const o = await s.receive(base);
    expect(o.orderNumber).toBe(8);
  });

  it('rejects empty items', async () => {
    await expect(s.receive({ ...base, items: [] })).rejects.toThrow('sin items');
  });

  it('rejects invalid quantity', async () => {
    await expect(s.receive({ ...base, items: [{ sku: 'X', name: 'Y', quantity: 0, unitPrice: 100 }] })).rejects.toThrow('Cantidad');
  });

  it('rejects estimated minutes out of range', async () => {
    await expect(s.receive({ ...base, estimatedMinutes: 500 })).rejects.toThrow('0 y 480');
  });

  it('starts preparing', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'o1', status: 'RECEIVED' }]));
    const o = await s.startPreparing('m1', 'o1');
    expect(o?.status).toBe('PREPARING');
    expect(o?.preparingAt).toBeDefined();
  });

  it('rejects prepare if not received', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'o1', status: 'PREPARING' }]));
    await expect(s.startPreparing('m1', 'o1')).rejects.toThrow('recibidos');
  });

  it('marks ready', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'o1', status: 'PREPARING' }]));
    const o = await s.markReady('m1', 'o1');
    expect(o?.status).toBe('READY');
  });

  it('delivers order', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'o1', status: 'READY' }]));
    const o = await s.deliver('m1', 'o1');
    expect(o?.status).toBe('DELIVERED');
  });

  it('cancels order with reason', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'o1', status: 'PREPARING' }]));
    const o = await s.cancel('m1', 'o1', 'Cliente ausente');
    expect(o?.status).toBe('CANCELLED');
    expect(o?.cancellationReason).toBe('Cliente ausente');
  });

  it('rejects cancel on delivered', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'o1', status: 'DELIVERED' }]));
    await expect(s.cancel('m1', 'o1', 'x')).rejects.toThrow('entregado');
  });

  it('returns active orders sorted', async () => {
    const t1 = new Date(Date.now() - 600000).toISOString();
    const t2 = new Date(Date.now() - 300000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'o1', status: 'PREPARING', receivedAt: t2 },
      { id: 'o2', status: 'RECEIVED', receivedAt: t1 },
      { id: 'o3', status: 'DELIVERED', receivedAt: t1 },
    ]));
    const active = await s.getActive('m1');
    expect(active).toHaveLength(2);
    expect(active[0].id).toBe('o2');
  });

  it('computes average times', async () => {
    const received = new Date(Date.now() - 30 * 60000).toISOString();
    const preparing = new Date(Date.now() - 25 * 60000).toISOString();
    const ready = new Date(Date.now() - 10 * 60000).toISOString();
    const delivered = new Date().toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'DELIVERED', receivedAt: received, preparingAt: preparing, readyAt: ready, deliveredAt: delivered },
    ]));
    const avg = await s.getAverageTime('m1');
    expect(avg.preparingMinutes).toBeGreaterThanOrEqual(14);
    expect(avg.totalMinutes).toBeGreaterThanOrEqual(29);
    expect(avg.sampleSize).toBe(1);
  });

  it('computes daily stats', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'DELIVERED', totalAmount: 10000, receivedAt: '2026-04-12T10:00:00Z' },
      { status: 'DELIVERED', totalAmount: 25000, receivedAt: '2026-04-12T14:00:00Z' },
      { status: 'CANCELLED', totalAmount: 5000, receivedAt: '2026-04-12T16:00:00Z' },
      { status: 'DELIVERED', totalAmount: 99999, receivedAt: '2026-04-11T10:00:00Z' },
    ]));
    const stats = await s.getDailyStats('m1', '2026-04-12');
    expect(stats.received).toBe(3);
    expect(stats.delivered).toBe(2);
    expect(stats.cancelled).toBe(1);
    expect(stats.revenue).toBe(35000);
  });
});
