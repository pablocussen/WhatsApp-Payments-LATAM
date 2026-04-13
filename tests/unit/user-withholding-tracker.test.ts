const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserWithholdingTrackerService } from '../../src/services/user-withholding-tracker.service';

describe('UserWithholdingTrackerService', () => {
  let s: UserWithholdingTrackerService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserWithholdingTrackerService(); mockRedisGet.mockResolvedValue(null); });

  const base = {
    userId: 'u1',
    type: 'HONORARIOS' as const,
    payerName: 'Asesorias Cussen SpA',
    payerRUT: '77123456-7',
    grossAmount: 1000000,
    period: '2026-04',
  };

  it('records honorarios with default 13.75% rate', async () => {
    const r = await s.record(base);
    expect(r.retentionRate).toBe(13.75);
    expect(r.withheld).toBe(137500);
    expect(r.netAmount).toBe(862500);
  });

  it('records arriendo with default 10% rate', async () => {
    const r = await s.record({ ...base, type: 'ARRIENDO' });
    expect(r.retentionRate).toBe(10);
    expect(r.withheld).toBe(100000);
  });

  it('rejects invalid RUT', async () => {
    await expect(s.record({ ...base, payerRUT: '12345' })).rejects.toThrow('RUT');
  });

  it('accepts RUT with K', async () => {
    const r = await s.record({ ...base, payerRUT: '12345678-K' });
    expect(r.id).toBeDefined();
  });

  it('rejects invalid period', async () => {
    await expect(s.record({ ...base, period: '2026/04' })).rejects.toThrow('YYYY-MM');
  });

  it('rejects zero gross amount', async () => {
    await expect(s.record({ ...base, grossAmount: 0 })).rejects.toThrow('positivo');
  });

  it('allows custom retention rate', async () => {
    const r = await s.record({ ...base, retentionRate: 25 });
    expect(r.retentionRate).toBe(25);
    expect(r.withheld).toBe(250000);
  });

  it('rejects rate over 50%', async () => {
    await expect(s.record({ ...base, retentionRate: 60 })).rejects.toThrow('50');
  });

  it('deletes record', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'r1' }, { id: 'r2' }]));
    expect(await s.delete('u1', 'r1')).toBe(true);
  });

  it('computes year summary', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { type: 'HONORARIOS', period: '2026-01', grossAmount: 500000, withheld: 68750 },
      { type: 'HONORARIOS', period: '2026-02', grossAmount: 500000, withheld: 68750 },
      { type: 'ARRIENDO', period: '2026-03', grossAmount: 300000, withheld: 30000 },
      { type: 'HONORARIOS', period: '2025-12', grossAmount: 99999, withheld: 0 },
    ]));
    const summary = await s.getYearSummary('u1', 2026);
    expect(summary.totalGross).toBe(1300000);
    expect(summary.totalWithheld).toBe(167500);
    expect(summary.byType.HONORARIOS.count).toBe(2);
    expect(summary.byType.ARRIENDO.count).toBe(1);
  });

  it('filters by period', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { period: '2026-04' }, { period: '2026-05' }, { period: '2026-04' },
    ]));
    const records = await s.getByPeriod('u1', '2026-04');
    expect(records).toHaveLength(2);
  });

  it('exports for tax filing', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { type: 'HONORARIOS', period: '2026-06', grossAmount: 1000000, withheld: 137500 },
    ]));
    const exported = await s.exportForTaxFiling('u1', 2026);
    expect(exported).toContain('2026');
    expect(exported).toContain('1.000.000');
    expect(exported).toContain('HONORARIOS');
  });
});
