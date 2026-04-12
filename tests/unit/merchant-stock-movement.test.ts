const mockRedisLPush = jest.fn().mockResolvedValue(1);
const mockRedisLTrim = jest.fn().mockResolvedValue('OK');
const mockRedisLRange = jest.fn().mockResolvedValue([]);
const mockRedisExpire = jest.fn().mockResolvedValue(true);
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ lPush: (...a: unknown[]) => mockRedisLPush(...a), lTrim: (...a: unknown[]) => mockRedisLTrim(...a), lRange: (...a: unknown[]) => mockRedisLRange(...a), expire: (...a: unknown[]) => mockRedisExpire(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantStockMovementService } from '../../src/services/merchant-stock-movement.service';

describe('MerchantStockMovementService', () => {
  let s: MerchantStockMovementService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantStockMovementService(); mockRedisLRange.mockResolvedValue([]); });

  it('records sale (out)', async () => {
    const m = await s.recordMovement({ merchantId: 'm1', productId: 'p1', reason: 'SALE', quantity: 5, previousStock: 20, createdBy: 'u1' });
    expect(m.type).toBe('OUT');
    expect(m.newStock).toBe(15);
  });

  it('records purchase (in)', async () => {
    const m = await s.recordMovement({ merchantId: 'm1', productId: 'p1', reason: 'PURCHASE', quantity: 10, previousStock: 5, createdBy: 'u1' });
    expect(m.type).toBe('IN');
    expect(m.newStock).toBe(15);
  });

  it('records loss', async () => {
    const m = await s.recordMovement({ merchantId: 'm1', productId: 'p1', reason: 'LOSS', quantity: 2, previousStock: 10, createdBy: 'u1' });
    expect(m.type).toBe('OUT');
    expect(m.newStock).toBe(8);
  });

  it('rejects zero quantity', async () => {
    await expect(s.recordMovement({ merchantId: 'm1', productId: 'p1', reason: 'SALE', quantity: 0, previousStock: 10, createdBy: 'u1' })).rejects.toThrow('distinta de 0');
  });

  it('rejects negative resulting stock', async () => {
    await expect(s.recordMovement({ merchantId: 'm1', productId: 'p1', reason: 'SALE', quantity: 100, previousStock: 5, createdBy: 'u1' })).rejects.toThrow('negativo');
  });

  it('returns empty movements', async () => {
    expect(await s.getMovements('m1', 'p1')).toEqual([]);
  });

  it('returns parsed movements', async () => {
    mockRedisLRange.mockResolvedValue([JSON.stringify({ id: 'm1', type: 'IN', quantity: 5 })]);
    expect(await s.getMovements('m1', 'p1')).toHaveLength(1);
  });

  it('calculates stock summary', async () => {
    mockRedisLRange.mockResolvedValue([
      JSON.stringify({ type: 'IN', quantity: 10 }),
      JSON.stringify({ type: 'OUT', quantity: 3 }),
      JSON.stringify({ type: 'IN', quantity: 5 }),
      JSON.stringify({ type: 'OUT', quantity: 2 }),
    ]);
    const sum = await s.getStockSummary('m1', 'p1');
    expect(sum.totalIn).toBe(15);
    expect(sum.totalOut).toBe(5);
    expect(sum.netChange).toBe(10);
  });
});
