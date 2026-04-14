const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantCashDropService } from '../../src/services/merchant-cash-drop.service';

describe('MerchantCashDropService', () => {
  let s: MerchantCashDropService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantCashDropService(); mockRedisGet.mockResolvedValue(null); });

  const base = {
    merchantId: 'm1',
    shiftId: 'sh1',
    employeeId: 'e1',
    employeeName: 'Maria',
    amount: 500000,
    denominations: [
      { value: 20000, count: 20 },
      { value: 10000, count: 10 },
    ],
    safeLocation: 'Caja fuerte principal',
  };

  it('records drop', async () => {
    const d = await s.recordDrop(base);
    expect(d.status).toBe('PENDING');
    expect(d.amount).toBe(500000);
  });

  it('rejects zero amount', async () => {
    await expect(s.recordDrop({ ...base, amount: 0 })).rejects.toThrow('positivo');
  });

  it('rejects denominations not matching amount', async () => {
    await expect(s.recordDrop({
      ...base,
      denominations: [{ value: 20000, count: 10 }],
    })).rejects.toThrow('no coincide');
  });

  it('rejects missing safe location', async () => {
    await expect(s.recordDrop({ ...base, safeLocation: '' })).rejects.toThrow('Ubicacion');
  });

  it('marks deposited with reference', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1', status: 'PENDING' }]));
    const d = await s.markDeposited('m1', 'd1', 'BKREF-001');
    expect(d?.status).toBe('DEPOSITED');
    expect(d?.bankReference).toBe('BKREF-001');
  });

  it('rejects deposit without reference', async () => {
    await expect(s.markDeposited('m1', 'd1', '')).rejects.toThrow('Referencia');
  });

  it('rejects deposit on non-pending', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1', status: 'DEPOSITED' }]));
    await expect(s.markDeposited('m1', 'd1', 'BK-1')).rejects.toThrow('ya en estado');
  });

  it('marks lost with reason', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1', status: 'PENDING' }]));
    const d = await s.markLost('m1', 'd1', 'Robo reportado');
    expect(d?.status).toBe('LOST');
    expect(d?.notes).toBe('Robo reportado');
  });

  it('rejects lost on deposited', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1', status: 'DEPOSITED' }]));
    await expect(s.markLost('m1', 'd1', 'x')).rejects.toThrow('depositado');
  });

  it('cancels pending drop', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1', status: 'PENDING' }]));
    const d = await s.cancel('m1', 'd1');
    expect(d?.status).toBe('CANCELLED');
  });

  it('returns pending sorted', async () => {
    const older = new Date(Date.now() - 3600000).toISOString();
    const newer = new Date().toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'd1', status: 'PENDING', createdAt: newer },
      { id: 'd2', status: 'PENDING', createdAt: older },
      { id: 'd3', status: 'DEPOSITED', createdAt: older },
    ]));
    const pending = await s.getPending('m1');
    expect(pending).toHaveLength(2);
    expect(pending[0].id).toBe('d2');
  });

  it('computes daily summary', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'DEPOSITED', amount: 500000, createdAt: '2026-04-14T08:00:00Z' },
      { status: 'PENDING', amount: 300000, createdAt: '2026-04-14T12:00:00Z' },
      { status: 'LOST', amount: 50000, createdAt: '2026-04-14T14:00:00Z' },
      { status: 'DEPOSITED', amount: 999999, createdAt: '2026-04-13T10:00:00Z' },
    ]));
    const summary = await s.getDailySummary('m1', '2026-04-14');
    expect(summary.totalDropped).toBe(850000);
    expect(summary.totalDeposited).toBe(500000);
    expect(summary.pending).toBe(1);
    expect(summary.lost).toBe(1);
    expect(summary.dropCount).toBe(3);
  });

  it('filters by employee sorted desc', async () => {
    const d1 = new Date(Date.now() - 3600000).toISOString();
    const d2 = new Date().toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { employeeId: 'e1', createdAt: d1 },
      { employeeId: 'e2', createdAt: d2 },
      { employeeId: 'e1', createdAt: d2 },
    ]));
    const drops = await s.getByEmployee('m1', 'e1');
    expect(drops).toHaveLength(2);
    expect(drops[0].createdAt).toBe(d2);
  });
});
