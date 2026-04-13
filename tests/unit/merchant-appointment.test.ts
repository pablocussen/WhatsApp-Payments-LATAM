const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantAppointmentService } from '../../src/services/merchant-appointment.service';

describe('MerchantAppointmentService', () => {
  let s: MerchantAppointmentService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantAppointmentService(); mockRedisGet.mockResolvedValue(null); });

  const base = () => ({
    merchantId: 'm1',
    serviceId: 'svc1',
    serviceName: 'Corte',
    customerId: 'c1',
    customerName: 'Pablo',
    customerPhone: '+56912345678',
    startAt: new Date(Date.now() + 3600000).toISOString(),
    durationMinutes: 60,
    price: 15000,
  });

  it('books appointment', async () => {
    const a = await s.book(base());
    expect(a.status).toBe('SCHEDULED');
    expect(a.endAt).toBeDefined();
  });

  it('rejects invalid duration', async () => {
    await expect(s.book({ ...base(), durationMinutes: 1 })).rejects.toThrow('5 y 480');
  });

  it('rejects negative price', async () => {
    await expect(s.book({ ...base(), price: -100 })).rejects.toThrow('negativo');
  });

  it('rejects invalid phone', async () => {
    await expect(s.book({ ...base(), customerPhone: 'abc' })).rejects.toThrow('Telefono');
  });

  it('rejects past date', async () => {
    await expect(s.book({ ...base(), startAt: new Date(Date.now() - 3600000).toISOString() })).rejects.toThrow('pasado');
  });

  it('rejects time conflict', async () => {
    const startAt = new Date(Date.now() + 3600000).toISOString();
    const endAt = new Date(Date.now() + 3600000 + 60 * 60000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      status: 'SCHEDULED', startAt, endAt,
    }]));
    await expect(s.book(base())).rejects.toThrow('Conflicto');
  });

  it('allows booking over cancelled appointment', async () => {
    const startAt = new Date(Date.now() + 3600000).toISOString();
    const endAt = new Date(Date.now() + 3600000 + 60 * 60000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      status: 'CANCELLED', startAt, endAt,
    }]));
    const a = await s.book(base());
    expect(a.status).toBe('SCHEDULED');
  });

  it('confirms scheduled', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'a1', status: 'SCHEDULED' }]));
    const a = await s.confirm('m1', 'a1');
    expect(a?.status).toBe('CONFIRMED');
  });

  it('completes confirmed', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'a1', status: 'CONFIRMED' }]));
    const a = await s.complete('m1', 'a1');
    expect(a?.status).toBe('COMPLETED');
  });

  it('rejects complete on cancelled', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'a1', status: 'CANCELLED' }]));
    await expect(s.complete('m1', 'a1')).rejects.toThrow('activas');
  });

  it('cancels scheduled', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'a1', status: 'SCHEDULED' }]));
    const a = await s.cancel('m1', 'a1');
    expect(a?.status).toBe('CANCELLED');
  });

  it('rejects cancel on completed', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'a1', status: 'COMPLETED' }]));
    await expect(s.cancel('m1', 'a1')).rejects.toThrow('completada');
  });

  it('marks no show', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'a1', status: 'CONFIRMED' }]));
    const a = await s.markNoShow('m1', 'a1');
    expect(a?.status).toBe('NO_SHOW');
  });

  it('returns upcoming sorted', async () => {
    const later = new Date(Date.now() + 7200000).toISOString();
    const sooner = new Date(Date.now() + 3600000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'a1', status: 'SCHEDULED', startAt: later },
      { id: 'a2', status: 'CONFIRMED', startAt: sooner },
      { id: 'a3', status: 'CANCELLED', startAt: sooner },
    ]));
    const upcoming = await s.getUpcoming('m1');
    expect(upcoming).toHaveLength(2);
    expect(upcoming[0].id).toBe('a2');
  });

  it('computes no-show rate', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'COMPLETED' }, { status: 'COMPLETED' }, { status: 'NO_SHOW' }, { status: 'CANCELLED' },
    ]));
    expect(await s.getNoShowRate('m1')).toBe(33);
  });
});
