const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserBulkPaymentService } from '../../src/services/user-bulk-payment.service';

describe('UserBulkPaymentService', () => {
  let s: UserBulkPaymentService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserBulkPaymentService(); mockRedisGet.mockResolvedValue(null); });

  const validRecipients = [
    { phone: '+56912345678', name: 'Maria', amount: 25000 },
    { phone: '+56987654321', name: 'Pedro', amount: 15000 },
  ];

  it('creates draft batch', async () => {
    const b = await s.create({ userId: 'u1', name: 'Sueldos Abril', recipients: validRecipients });
    expect(b.status).toBe('DRAFT');
    expect(b.totalAmount).toBe(40000);
    expect(b.recipientCount).toBe(2);
  });

  it('rejects empty recipients', async () => {
    await expect(s.create({ userId: 'u1', name: 'x', recipients: [] })).rejects.toThrow('destinatario');
  });

  it('rejects invalid phone', async () => {
    await expect(s.create({
      userId: 'u1', name: 'x',
      recipients: [{ phone: 'abc', name: 'x', amount: 1000 }],
    })).rejects.toThrow('Telefono');
  });

  it('rejects zero amount', async () => {
    await expect(s.create({
      userId: 'u1', name: 'x',
      recipients: [{ phone: '+56912345678', name: 'x', amount: 0 }],
    })).rejects.toThrow('Monto');
  });

  it('rejects total over 50M', async () => {
    await expect(s.create({
      userId: 'u1', name: 'x',
      recipients: [{ phone: '+56912345678', name: 'x', amount: 60000000 }],
    })).rejects.toThrow('50.000.000');
  });

  it('schedules draft batch', async () => {
    const future = new Date(Date.now() + 3600000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'b1', status: 'DRAFT' }]));
    const b = await s.schedule('u1', 'b1', future);
    expect(b?.status).toBe('SCHEDULED');
  });

  it('rejects schedule in the past', async () => {
    const past = new Date(Date.now() - 3600000).toISOString();
    await expect(s.schedule('u1', 'b1', past)).rejects.toThrow('futura');
  });

  it('starts processing', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'b1', status: 'SCHEDULED' }]));
    const b = await s.startProcessing('u1', 'b1');
    expect(b?.status).toBe('PROCESSING');
    expect(b?.startedAt).toBeDefined();
  });

  it('records successful recipient', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'b1', status: 'PROCESSING', recipientCount: 2,
      successCount: 0, failureCount: 0,
      recipients: [
        { phone: '+56912345678', status: 'PENDING' },
        { phone: '+56987654321', status: 'PENDING' },
      ],
    }]));
    const b = await s.recordRecipientResult('u1', 'b1', '+56912345678', 'SENT', 'tx1');
    expect(b?.successCount).toBe(1);
    expect(b?.status).toBe('PROCESSING');
  });

  it('marks completed when all recipients done', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'b1', status: 'PROCESSING', recipientCount: 2,
      successCount: 1, failureCount: 0,
      recipients: [
        { phone: '+56912345678', status: 'SENT' },
        { phone: '+56987654321', status: 'PENDING' },
      ],
    }]));
    const b = await s.recordRecipientResult('u1', 'b1', '+56987654321', 'SENT', 'tx2');
    expect(b?.status).toBe('COMPLETED');
  });

  it('marks failed when all fail', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'b1', status: 'PROCESSING', recipientCount: 1,
      successCount: 0, failureCount: 0,
      recipients: [{ phone: '+56912345678', status: 'PENDING' }],
    }]));
    const b = await s.recordRecipientResult('u1', 'b1', '+56912345678', 'FAILED', undefined, 'no funds');
    expect(b?.status).toBe('FAILED');
  });

  it('cancels draft batch', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'b1', status: 'DRAFT' }]));
    const b = await s.cancel('u1', 'b1');
    expect(b?.status).toBe('CANCELLED');
  });

  it('rejects cancel on completed', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'b1', status: 'COMPLETED' }]));
    await expect(s.cancel('u1', 'b1')).rejects.toThrow('finalizado');
  });

  it('computes progress percentage', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'b1', recipientCount: 10, successCount: 3, failureCount: 2,
    }]));
    const p = await s.getProgress('u1', 'b1');
    expect(p?.completed).toBe(5);
    expect(p?.percentage).toBe(50);
  });

  it('returns due batches', async () => {
    const past = new Date(Date.now() - 3600000).toISOString();
    const future = new Date(Date.now() + 3600000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'b1', status: 'SCHEDULED', scheduledAt: past },
      { id: 'b2', status: 'SCHEDULED', scheduledAt: future },
      { id: 'b3', status: 'DRAFT', scheduledAt: past },
    ]));
    const due = await s.getDueForProcessing('u1');
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe('b1');
  });
});
