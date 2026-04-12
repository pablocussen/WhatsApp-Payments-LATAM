const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisDel = jest.fn().mockResolvedValue(1);
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a), del: (...a: unknown[]) => mockRedisDel(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantShiftService } from '../../src/services/merchant-shift.service';

describe('MerchantShiftService', () => {
  let s: MerchantShiftService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantShiftService(); mockRedisGet.mockResolvedValue(null); });

  it('opens shift', async () => {
    const sh = await s.openShift({ merchantId: 'm1', cashierId: 'c1', cashierName: 'Juan', openingAmount: 50000 });
    expect(sh.id).toMatch(/^shift_/);
    expect(sh.status).toBe('OPEN');
    expect(sh.openingAmount).toBe(50000);
  });
  it('rejects negative opening', async () => {
    await expect(s.openShift({ merchantId: 'm1', cashierId: 'c1', cashierName: 'X', openingAmount: -100 }))
      .rejects.toThrow('positivo');
  });
  it('rejects duplicate active shift', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.includes('active:')) return Promise.resolve('shift_existing');
      return Promise.resolve(JSON.stringify({ id: 'shift_existing', status: 'OPEN', merchantId: 'm1', cashierId: 'c1' }));
    });
    await expect(s.openShift({ merchantId: 'm1', cashierId: 'c1', cashierName: 'X', openingAmount: 10000 }))
      .rejects.toThrow('Ya existe');
  });
  it('records cash transaction', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'shift_1', status: 'OPEN', totalCash: 0, totalDigital: 0, transactionCount: 0 }));
    expect(await s.recordTransaction('shift_1', 5000, true)).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.totalCash).toBe(5000);
    expect(saved.transactionCount).toBe(1);
  });
  it('records digital transaction', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'shift_1', status: 'OPEN', totalCash: 0, totalDigital: 0, transactionCount: 0 }));
    await s.recordTransaction('shift_1', 8000, false);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.totalDigital).toBe(8000);
  });
  it('rejects transaction on closed shift', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'shift_1', status: 'CLOSED' }));
    expect(await s.recordTransaction('shift_1', 5000, true)).toBe(false);
  });
  it('closes shift', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'shift_1', status: 'OPEN', openingAmount: 50000, totalCash: 30000, totalDigital: 20000, merchantId: 'm1', cashierId: 'c1' }));
    const sh = await s.closeShift('shift_1', 80000);
    expect(sh?.status).toBe('CLOSED');
    expect(sh?.closingAmount).toBe(80000);
  });
  it('calculates discrepancy — cuadra', () => {
    const disc = s.calculateDiscrepancy({ openingAmount: 50000, totalCash: 30000, closingAmount: 80000 } as any);
    expect(disc).toBe(0);
  });
  it('calculates discrepancy — sobra', () => {
    const disc = s.calculateDiscrepancy({ openingAmount: 50000, totalCash: 30000, closingAmount: 85000 } as any);
    expect(disc).toBe(5000);
  });
  it('calculates discrepancy — falta', () => {
    const disc = s.calculateDiscrepancy({ openingAmount: 50000, totalCash: 30000, closingAmount: 75000 } as any);
    expect(disc).toBe(-5000);
  });
  it('formats summary', () => {
    const f = s.formatShiftSummary({
      id: 'shift_1', cashierName: 'Juan', transactionCount: 25,
      totalCash: 50000, totalDigital: 30000,
      openingAmount: 20000, closingAmount: 70000, status: 'CLOSED',
    } as any);
    expect(f).toContain('Juan');
    expect(f).toContain('25 tx');
    expect(f).toContain('$80.000');
    expect(f).toContain('cuadra');
  });
});
