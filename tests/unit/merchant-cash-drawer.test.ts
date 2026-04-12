const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantCashDrawerService } from '../../src/services/merchant-cash-drawer.service';

describe('MerchantCashDrawerService', () => {
  let s: MerchantCashDrawerService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantCashDrawerService(); mockRedisGet.mockResolvedValue(null); });

  it('opens drawer', async () => {
    const d = await s.openDrawer('m1', 'pos1', 50000);
    expect(d.id).toMatch(/^drwr_/);
    expect(d.openingBalance).toBe(50000);
    expect(d.status).toBe('OPEN');
  });
  it('rejects negative opening', async () => {
    await expect(s.openDrawer('m1', 'pos1', -100)).rejects.toThrow('positivo');
  });
  it('adds sale movement (in)', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'd1', status: 'OPEN', currentBalance: 50000, expectedBalance: 50000, movements: [] }));
    expect(await s.addMovement('d1', 'SALE', 10000, 'Venta')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.currentBalance).toBe(60000);
    expect(saved.movements).toHaveLength(1);
  });
  it('adds withdrawal (out)', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'd1', status: 'OPEN', currentBalance: 50000, expectedBalance: 50000, movements: [] }));
    await s.addMovement('d1', 'WITHDRAWAL', 5000, 'Retiro');
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.currentBalance).toBe(45000);
  });
  it('rejects movement on closed', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'd1', status: 'CLOSED' }));
    expect(await s.addMovement('d1', 'SALE', 1000, 'X')).toBe(false);
  });
  it('closes with cuadra', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'd1', status: 'OPEN', expectedBalance: 80000, movements: [] }));
    const d = await s.closeDrawer('d1', 80000);
    expect(d?.status).toBe('CLOSED');
    expect(d?.closingDifference).toBe(0);
  });
  it('closes with sobrante', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'd1', status: 'OPEN', expectedBalance: 80000, movements: [] }));
    const d = await s.closeDrawer('d1', 85000);
    expect(d?.closingDifference).toBe(5000);
  });
  it('closes con falta', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'd1', status: 'OPEN', expectedBalance: 80000, movements: [] }));
    const d = await s.closeDrawer('d1', 75000);
    expect(d?.closingDifference).toBe(-5000);
  });
  it('formats summary', () => {
    const f = s.formatDrawerSummary({ id: 'd1', currentBalance: 100000, movements: [{}, {}, {}], status: 'CLOSED', closingDifference: 0 } as any);
    expect(f).toContain('$100.000');
    expect(f).toContain('3 movs');
    expect(f).toContain('cuadra');
  });
});
