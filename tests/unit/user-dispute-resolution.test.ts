const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserDisputeResolutionService } from '../../src/services/user-dispute-resolution.service';

describe('UserDisputeResolutionService', () => {
  let s: UserDisputeResolutionService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserDisputeResolutionService(); mockRedisGet.mockResolvedValue(null); });

  const base = {
    userId: 'u1',
    transactionId: 'tx1',
    category: 'UNAUTHORIZED' as const,
    amount: 50000,
    description: 'No reconozco esta transaccion en mi cuenta',
  };

  it('opens dispute', async () => {
    const d = await s.open(base);
    expect(d.status).toBe('OPEN');
    expect(d.messages).toHaveLength(1);
  });

  it('rejects short description', async () => {
    await expect(s.open({ ...base, description: 'no' })).rejects.toThrow('10 y 1000');
  });

  it('rejects non-HTTPS evidence', async () => {
    await expect(s.open({ ...base, evidenceUrls: ['http://example.com/evidence.jpg'] })).rejects.toThrow('HTTPS');
  });

  it('rejects duplicate active dispute', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ transactionId: 'tx1', status: 'OPEN' }]));
    await expect(s.open(base)).rejects.toThrow('Ya existe');
  });

  it('allows new dispute after closed', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ transactionId: 'tx1', status: 'CLOSED_NO_ACTION' }]));
    const d = await s.open(base);
    expect(d.status).toBe('OPEN');
  });

  it('starts review', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1', status: 'OPEN' }]));
    const d = await s.startReview('u1', 'd1');
    expect(d?.status).toBe('IN_REVIEW');
  });

  it('adds message to open dispute', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1', status: 'IN_REVIEW', messages: [] }]));
    const d = await s.addMessage('u1', 'd1', 'SUPPORT', 'Estamos revisando');
    expect(d?.messages).toHaveLength(1);
  });

  it('rejects message on closed', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1', status: 'RESOLVED_USER' }]));
    await expect(s.addMessage('u1', 'd1', 'USER', 'Hola')).rejects.toThrow('cerrada');
  });

  it('resolves in favor of user', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1', status: 'IN_REVIEW' }]));
    const d = await s.resolve('u1', 'd1', 'USER', 'Reembolso aprobado');
    expect(d?.status).toBe('RESOLVED_USER');
  });

  it('rejects resolve on already closed', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1', status: 'RESOLVED_USER' }]));
    await expect(s.resolve('u1', 'd1', 'USER', 'x')).rejects.toThrow('ya cerrada');
  });

  it('escalates open dispute', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1', status: 'OPEN' }]));
    const d = await s.escalate('u1', 'd1');
    expect(d?.status).toBe('ESCALATED');
  });

  it('returns active disputes', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'OPEN' }, { status: 'IN_REVIEW' }, { status: 'RESOLVED_USER' }, { status: 'ESCALATED' },
    ]));
    expect((await s.getActive('u1'))).toHaveLength(3);
  });

  it('filters by category', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { category: 'FRAUD' }, { category: 'UNAUTHORIZED' }, { category: 'FRAUD' },
    ]));
    expect((await s.getByCategory('u1', 'FRAUD'))).toHaveLength(2);
  });

  it('computes stats with success rate', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'RESOLVED_USER', amount: 50000 },
      { status: 'RESOLVED_USER', amount: 30000 },
      { status: 'RESOLVED_MERCHANT', amount: 20000 },
      { status: 'OPEN', amount: 10000 },
    ]));
    const stats = await s.getStats('u1');
    expect(stats.total).toBe(4);
    expect(stats.open).toBe(1);
    expect(stats.resolvedInFavor).toBe(2);
    expect(stats.resolvedAgainst).toBe(1);
    expect(stats.successRate).toBe(67);
    expect(stats.totalAmount).toBe(80000);
  });
});
