const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserIOUService } from '../../src/services/user-iou.service';

describe('UserIOUService', () => {
  let s: UserIOUService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserIOUService(); mockRedisGet.mockResolvedValue(null); });

  const base = {
    userId: 'u1',
    direction: 'OWED_TO_ME' as const,
    counterpartyId: 'c1',
    counterpartyName: 'Pedro',
    counterpartyPhone: '+56912345678',
    totalAmount: 50000,
    description: 'Prestamo almuerzo',
  };

  it('creates IOU', async () => {
    const i = await s.create(base);
    expect(i.status).toBe('OPEN');
    expect(i.paidAmount).toBe(0);
  });

  it('rejects zero amount', async () => {
    await expect(s.create({ ...base, totalAmount: 0 })).rejects.toThrow('positivo');
  });

  it('rejects invalid phone', async () => {
    await expect(s.create({ ...base, counterpartyPhone: 'abc' })).rejects.toThrow('Telefono');
  });

  it('rejects over 100 open', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(Array.from({ length: 100 }, (_, i) => ({ id: 'i' + i, status: 'OPEN' }))));
    await expect(s.create(base)).rejects.toThrow('100');
  });

  it('records partial payment', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'i1', totalAmount: 50000, paidAmount: 0, status: 'OPEN' }]));
    const i = await s.recordPayment('u1', 'i1', 20000);
    expect(i?.status).toBe('PARTIAL');
    expect(i?.paidAmount).toBe(20000);
  });

  it('marks paid when fully paid', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'i1', totalAmount: 50000, paidAmount: 30000, status: 'PARTIAL' }]));
    const i = await s.recordPayment('u1', 'i1', 20000);
    expect(i?.status).toBe('PAID');
  });

  it('rejects overpayment', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'i1', totalAmount: 50000, paidAmount: 40000, status: 'PARTIAL' }]));
    await expect(s.recordPayment('u1', 'i1', 20000)).rejects.toThrow('excede');
  });

  it('rejects payment on paid iou', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'i1', status: 'PAID' }]));
    await expect(s.recordPayment('u1', 'i1', 1000)).rejects.toThrow('aceptando');
  });

  it('cancels open iou', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'i1', status: 'OPEN' }]));
    const i = await s.cancel('u1', 'i1');
    expect(i?.status).toBe('CANCELLED');
  });

  it('rejects cancel on paid', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'i1', status: 'PAID' }]));
    await expect(s.cancel('u1', 'i1')).rejects.toThrow('pagado');
  });

  it('computes balance correctly', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { direction: 'OWED_TO_ME', status: 'OPEN', totalAmount: 50000, paidAmount: 10000 },
      { direction: 'OWED_TO_ME', status: 'PARTIAL', totalAmount: 30000, paidAmount: 10000 },
      { direction: 'I_OWE', status: 'OPEN', totalAmount: 25000, paidAmount: 0 },
      { direction: 'I_OWE', status: 'PAID', totalAmount: 999999, paidAmount: 999999 },
    ]));
    const bal = await s.getBalance('u1');
    expect(bal.owedToMe).toBe(60000);
    expect(bal.iOwe).toBe(25000);
    expect(bal.net).toBe(35000);
  });

  it('returns overdue iou', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'i1', status: 'OPEN', dueDate: past },
      { id: 'i2', status: 'OPEN', dueDate: future },
      { id: 'i3', status: 'PAID', dueDate: past },
    ]));
    const overdue = await s.getOverdue('u1');
    expect(overdue).toHaveLength(1);
    expect(overdue[0].id).toBe('i1');
  });

  it('filters by counterparty', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { counterpartyId: 'c1' },
      { counterpartyId: 'c2' },
      { counterpartyId: 'c1' },
    ]));
    const found = await s.getByCounterparty('u1', 'c1');
    expect(found).toHaveLength(2);
  });
});
