const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantTimeClockService } from '../../src/services/merchant-time-clock.service';

describe('MerchantTimeClockService', () => {
  let s: MerchantTimeClockService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantTimeClockService(); mockRedisGet.mockResolvedValue(null); });

  it('clocks in employee', async () => {
    const e = await s.clockIn({ merchantId: 'm1', employeeId: 'e1', employeeName: 'Maria', hourlyRate: 5000 });
    expect(e.status).toBe('CLOCKED_IN');
    expect(e.hourlyRate).toBe(5000);
  });

  it('rejects negative hourly rate', async () => {
    await expect(s.clockIn({ merchantId: 'm1', employeeId: 'e1', employeeName: 'x', hourlyRate: -100 })).rejects.toThrow('negativa');
  });

  it('rejects double clock in', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ employeeId: 'e1', status: 'CLOCKED_IN' }]));
    await expect(s.clockIn({ merchantId: 'm1', employeeId: 'e1', employeeName: 'x' })).rejects.toThrow('turno activo');
  });

  it('starts break', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 't1', employeeId: 'e1', status: 'CLOCKED_IN', breaks: [], totalBreakMinutes: 0,
    }]));
    const e = await s.startBreak('m1', 'e1');
    expect(e?.status).toBe('ON_BREAK');
    expect(e?.breaks).toHaveLength(1);
  });

  it('ends break and accumulates', async () => {
    const breakStart = new Date(Date.now() - 20 * 60000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 't1', employeeId: 'e1', status: 'ON_BREAK',
      breaks: [{ startAt: breakStart }], totalBreakMinutes: 0,
    }]));
    const e = await s.endBreak('m1', 'e1');
    expect(e?.status).toBe('CLOCKED_IN');
    expect(e?.totalBreakMinutes).toBeGreaterThanOrEqual(19);
  });

  it('clocks out and computes earnings', async () => {
    const clockInAt = new Date(Date.now() - 8 * 60 * 60000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 't1', employeeId: 'e1', employeeName: 'Maria',
      clockInAt, breaks: [], totalBreakMinutes: 0,
      totalWorkMinutes: 0, status: 'CLOCKED_IN', hourlyRate: 5000,
    }]));
    const e = await s.clockOut('m1', 'e1');
    expect(e?.status).toBe('CLOCKED_OUT');
    expect(e?.totalWorkMinutes).toBeGreaterThanOrEqual(479);
    expect(e?.earnedAmount).toBeGreaterThanOrEqual(39000);
  });

  it('auto-ends open break on clock out', async () => {
    const clockInAt = new Date(Date.now() - 60 * 60000).toISOString();
    const breakStart = new Date(Date.now() - 15 * 60000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 't1', employeeId: 'e1', employeeName: 'x',
      clockInAt, breaks: [{ startAt: breakStart }],
      totalBreakMinutes: 0, totalWorkMinutes: 0, status: 'ON_BREAK',
    }]));
    const e = await s.clockOut('m1', 'e1');
    expect(e?.status).toBe('CLOCKED_OUT');
    expect(e?.totalBreakMinutes).toBeGreaterThanOrEqual(14);
  });

  it('returns null for getActive when none', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ employeeId: 'e1', status: 'CLOCKED_OUT' }]));
    expect(await s.getActive('m1', 'e1')).toBeNull();
  });

  it('aggregates employee hours', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { employeeId: 'e1', status: 'CLOCKED_OUT', clockInAt: new Date().toISOString(), totalWorkMinutes: 240, earnedAmount: 20000 },
      { employeeId: 'e1', status: 'CLOCKED_OUT', clockInAt: new Date().toISOString(), totalWorkMinutes: 300, earnedAmount: 25000 },
      { employeeId: 'e2', status: 'CLOCKED_OUT', clockInAt: new Date().toISOString(), totalWorkMinutes: 480, earnedAmount: 40000 },
    ]));
    const hours = await s.getEmployeeHours('m1', 'e1');
    expect(hours.totalMinutes).toBe(540);
    expect(hours.totalEarned).toBe(45000);
    expect(hours.sessions).toBe(2);
  });

  it('returns currently active employees', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { employeeId: 'e1', status: 'CLOCKED_IN' },
      { employeeId: 'e2', status: 'ON_BREAK' },
      { employeeId: 'e3', status: 'CLOCKED_OUT' },
    ]));
    const active = await s.getCurrentlyActive('m1');
    expect(active).toHaveLength(2);
  });
});
