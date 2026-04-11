/**
 * MerchantHoursService — horarios de atención para comercios.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { MerchantHoursService } from '../../src/services/merchant-hours.service';

describe('MerchantHoursService', () => {
  let service: MerchantHoursService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MerchantHoursService();
    mockRedisGet.mockResolvedValue(null);
  });

  it('returns defaults for new merchant', async () => {
    const h = await service.getHours('m1');
    expect(h.merchantId).toBe('m1');
    expect(h.schedule.MON).toEqual({ open: '09:00', close: '18:00' });
    expect(h.schedule.SAT).toEqual({ open: '10:00', close: '14:00' });
    expect(h.schedule.SUN).toBeNull();
    expect(h.timezone).toBe('America/Santiago');
  });

  it('sets day hours', async () => {
    const h = await service.setDayHours('m1', 'SAT', { open: '08:00', close: '20:00' });
    expect(h.schedule.SAT).toEqual({ open: '08:00', close: '20:00' });
  });

  it('sets day as closed', async () => {
    const h = await service.setDayHours('m1', 'MON', null);
    expect(h.schedule.MON).toBeNull();
  });

  it('rejects invalid hours (close before open)', async () => {
    await expect(service.setDayHours('m1', 'MON', { open: '18:00', close: '09:00' }))
      .rejects.toThrow('antes del cierre');
  });

  it('adds holiday', async () => {
    const h = await service.addHoliday('m1', '2026-12-25');
    expect(h.holidaysClosed).toContain('2026-12-25');
  });

  it('does not duplicate holiday', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      merchantId: 'm1', holidaysClosed: ['2026-12-25'], schedule: {},
      timezone: 'America/Santiago', autoReplyWhenClosed: '', updatedAt: '',
    }));
    const h = await service.addHoliday('m1', '2026-12-25');
    expect(h.holidaysClosed.filter(d => d === '2026-12-25')).toHaveLength(1);
  });

  it('sets auto reply', async () => {
    const h = await service.setAutoReply('m1', 'Volvemos mañana!');
    expect(h.autoReplyWhenClosed).toBe('Volvemos mañana!');
  });

  it('rejects long auto reply', async () => {
    await expect(service.setAutoReply('m1', 'x'.repeat(501))).rejects.toThrow('500');
  });

  it('detects open on weekday during hours', () => {
    const hours = {
      merchantId: 'm1', timezone: 'America/Santiago',
      schedule: { MON: { open: '09:00', close: '18:00' }, TUE: null, WED: null, THU: null, FRI: null, SAT: null, SUN: null },
      holidaysClosed: [], autoReplyWhenClosed: '', updatedAt: '',
    };
    // Monday 12:00
    const monday = new Date('2026-04-13T12:00:00');
    expect(service.isOpen(hours, monday)).toBe(true);
  });

  it('detects closed on Sunday', () => {
    const hours = {
      merchantId: 'm1', timezone: 'America/Santiago',
      schedule: { MON: { open: '09:00', close: '18:00' }, TUE: null, WED: null, THU: null, FRI: null, SAT: null, SUN: null },
      holidaysClosed: [], autoReplyWhenClosed: '', updatedAt: '',
    };
    const sunday = new Date('2026-04-12T12:00:00');
    expect(service.isOpen(hours, sunday)).toBe(false);
  });

  it('detects closed on holiday', () => {
    const hours = {
      merchantId: 'm1', timezone: 'America/Santiago',
      schedule: { MON: { open: '09:00', close: '18:00' }, TUE: null, WED: null, THU: null, FRI: null, SAT: null, SUN: null },
      holidaysClosed: ['2026-04-13'], autoReplyWhenClosed: '', updatedAt: '',
    };
    const monday = new Date('2026-04-13T12:00:00');
    expect(service.isOpen(hours, monday)).toBe(false);
  });

  it('formats schedule', async () => {
    const h = await service.getHours('m1');
    const formatted = service.formatSchedule(h);
    expect(formatted).toContain('Lunes: 09:00 - 18:00');
    expect(formatted).toContain('Sábado: 10:00 - 14:00');
    expect(formatted).toContain('Domingo: Cerrado');
  });
});
