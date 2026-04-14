const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantShiftHandoverService } from '../../src/services/merchant-shift-handover.service';

describe('MerchantShiftHandoverService', () => {
  let s: MerchantShiftHandoverService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantShiftHandoverService(); mockRedisGet.mockResolvedValue(null); });

  const base = {
    merchantId: 'm1',
    fromShiftId: 'sh1',
    toShiftId: 'sh2',
    fromEmployeeId: 'e1',
    fromEmployeeName: 'Maria',
    toEmployeeId: 'e2',
    toEmployeeName: 'Pedro',
    cashInRegister: 100000,
    expectedCashInRegister: 100000,
    checklist: [
      { label: 'Caja registradora cuadrada', checked: false },
      { label: 'Inventario verificado', checked: false },
    ],
  };

  it('initiates handover with variance 0', async () => {
    const h = await s.initiate(base);
    expect(h.status).toBe('PENDING_ACCEPTANCE');
    expect(h.variance).toBe(0);
  });

  it('computes variance correctly', async () => {
    const h = await s.initiate({ ...base, cashInRegister: 95000 });
    expect(h.variance).toBe(-5000);
  });

  it('rejects same employee', async () => {
    await expect(s.initiate({ ...base, toEmployeeId: 'e1' })).rejects.toThrow('no pueden ser el mismo');
  });

  it('rejects empty checklist', async () => {
    await expect(s.initiate({ ...base, checklist: [] })).rejects.toThrow('Checklist');
  });

  it('rejects duplicate pending for same shift', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ fromShiftId: 'sh1', status: 'PENDING_ACCEPTANCE' }]));
    await expect(s.initiate(base)).rejects.toThrow('pendiente');
  });

  it('accepts handover when all checklist done', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'h1', status: 'PENDING_ACCEPTANCE', toEmployeeId: 'e2',
      checklist: [{ checked: true }, { checked: true }],
    }]));
    const h = await s.accept('m1', 'h1', 'e2');
    expect(h?.status).toBe('ACCEPTED');
  });

  it('rejects accept when checklist incomplete', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'h1', status: 'PENDING_ACCEPTANCE', toEmployeeId: 'e2',
      checklist: [{ checked: true }, { checked: false }],
    }]));
    await expect(s.accept('m1', 'h1', 'e2')).rejects.toThrow('checklist');
  });

  it('rejects accept by wrong employee', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'h1', status: 'PENDING_ACCEPTANCE', toEmployeeId: 'e2',
      checklist: [{ checked: true }],
    }]));
    await expect(s.accept('m1', 'h1', 'e99')).rejects.toThrow('receptor');
  });

  it('disputes pending handover', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'h1', status: 'PENDING_ACCEPTANCE' }]));
    const h = await s.dispute('m1', 'h1', 'Falta dinero en caja');
    expect(h?.status).toBe('DISPUTED');
    expect(h?.disputeReason).toBe('Falta dinero en caja');
  });

  it('rejects dispute with empty reason', async () => {
    await expect(s.dispute('m1', 'h1', '')).rejects.toThrow('Razon');
  });

  it('cancels pending handover', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'h1', status: 'PENDING_ACCEPTANCE' }]));
    const h = await s.cancel('m1', 'h1');
    expect(h?.status).toBe('CANCELLED');
  });

  it('rejects cancel on accepted', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'h1', status: 'ACCEPTED' }]));
    await expect(s.cancel('m1', 'h1')).rejects.toThrow('aceptado');
  });

  it('returns pending handovers', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'PENDING_ACCEPTANCE' },
      { status: 'ACCEPTED' },
      { status: 'PENDING_ACCEPTANCE' },
    ]));
    expect((await s.getPending('m1'))).toHaveLength(2);
  });

  it('computes variance report', async () => {
    const now = new Date().toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { initiatedAt: now, variance: 0, status: 'ACCEPTED' },
      { initiatedAt: now, variance: -5000, status: 'ACCEPTED' },
      { initiatedAt: now, variance: 3000, status: 'DISPUTED' },
      { initiatedAt: now, variance: 0, status: 'PENDING_ACCEPTANCE' },
    ]));
    const report = await s.getVarianceReport('m1');
    expect(report.totalHandovers).toBe(4);
    expect(report.withVariance).toBe(2);
    expect(report.totalVariance).toBe(8000);
    expect(report.disputed).toBe(1);
  });
});
