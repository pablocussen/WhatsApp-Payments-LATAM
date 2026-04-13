const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantTableQRService } from '../../src/services/merchant-table-qr.service';

describe('MerchantTableQRService', () => {
  let s: MerchantTableQRService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantTableQRService(); mockRedisGet.mockResolvedValue(null); });

  it('creates table', async () => {
    const t = await s.create({ merchantId: 'm1', number: 5, capacity: 4, zone: 'Terraza' });
    expect(t.status).toBe('FREE');
    expect(t.qrUrl).toContain('/t/m1/5');
  });

  it('rejects invalid number', async () => {
    await expect(s.create({ merchantId: 'm1', number: 0, capacity: 4, zone: 'x' })).rejects.toThrow('rango');
    await expect(s.create({ merchantId: 'm1', number: 1000, capacity: 4, zone: 'x' })).rejects.toThrow('rango');
  });

  it('rejects invalid capacity', async () => {
    await expect(s.create({ merchantId: 'm1', number: 1, capacity: 31, zone: 'x' })).rejects.toThrow('Capacidad');
  });

  it('rejects duplicate number', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ number: 5 }]));
    await expect(s.create({ merchantId: 'm1', number: 5, capacity: 4, zone: 'x' })).rejects.toThrow('5');
  });

  it('occupies free table', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ number: 1, status: 'FREE' }]));
    const t = await s.occupy('m1', 1);
    expect(t?.status).toBe('OCCUPIED');
    expect(t?.openedAt).toBeDefined();
  });

  it('rejects occupy non-free', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ number: 1, status: 'OCCUPIED' }]));
    await expect(s.occupy('m1', 1)).rejects.toThrow('no disponible');
  });

  it('adds to bill', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ number: 1, status: 'OCCUPIED', currentBillAmount: 10000 }]));
    const t = await s.addToBill('m1', 1, 5000);
    expect(t?.currentBillAmount).toBe(15000);
  });

  it('rejects add to bill when not occupied', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ number: 1, status: 'FREE' }]));
    await expect(s.addToBill('m1', 1, 5000)).rejects.toThrow('no ocupada');
  });

  it('requests payment', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ number: 1, status: 'OCCUPIED' }]));
    const t = await s.requestPayment('m1', 1);
    expect(t?.status).toBe('WAITING_PAYMENT');
  });

  it('closes table and accumulates revenue', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      number: 1, status: 'WAITING_PAYMENT', currentBillAmount: 25000,
      totalTransactions: 10, totalRevenue: 500000,
    }]));
    const t = await s.closeTable('m1', 1);
    expect(t?.status).toBe('FREE');
    expect(t?.totalTransactions).toBe(11);
    expect(t?.totalRevenue).toBe(525000);
    expect(t?.currentBillAmount).toBe(0);
  });

  it('filters by status', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { number: 1, status: 'FREE' },
      { number: 2, status: 'OCCUPIED' },
      { number: 3, status: 'OCCUPIED' },
    ]));
    const occupied = await s.getByStatus('m1', 'OCCUPIED');
    expect(occupied).toHaveLength(2);
  });

  it('computes occupancy rate', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'FREE' }, { status: 'OCCUPIED' }, { status: 'WAITING_PAYMENT' }, { status: 'FREE' },
    ]));
    expect(await s.getOccupancyRate('m1')).toBe(50);
  });
});
