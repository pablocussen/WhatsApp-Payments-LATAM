const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserPaymentPotService } from '../../src/services/user-payment-pot.service';

describe('UserPaymentPotService', () => {
  let s: UserPaymentPotService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserPaymentPotService(); mockRedisGet.mockResolvedValue(null); });

  it('creates pot', async () => {
    const p = await s.create({ ownerId: 'u1', title: 'Regalo mama', description: 'Colecta familiar', targetAmount: 100000 });
    expect(p.status).toBe('OPEN');
    expect(p.contributions).toEqual([]);
  });

  it('rejects zero target', async () => {
    await expect(s.create({ ownerId: 'u1', title: 'x', description: 'y', targetAmount: 0 })).rejects.toThrow('positiva');
  });

  it('rejects over 10 open pots', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ id: 'p' + i, status: 'OPEN' }))));
    await expect(s.create({ ownerId: 'u1', title: 'x', description: 'y', targetAmount: 1000 })).rejects.toThrow('10');
  });

  it('accepts contribution', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'p1', status: 'OPEN', currentAmount: 5000, targetAmount: 100000, contributions: [] }]));
    const p = await s.contribute('u1', 'p1', { contributorId: 'c1', name: 'Juan', amount: 20000 });
    expect(p?.currentAmount).toBe(25000);
    expect(p?.contributions).toHaveLength(1);
  });

  it('closes pot when target reached', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'p1', status: 'OPEN', currentAmount: 95000, targetAmount: 100000, contributions: [] }]));
    const p = await s.contribute('u1', 'p1', { contributorId: 'c1', name: 'Juan', amount: 10000 });
    expect(p?.status).toBe('CLOSED');
    expect(p?.closedAt).toBeDefined();
  });

  it('rejects contribution to closed pot', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'p1', status: 'CLOSED', currentAmount: 100000, targetAmount: 100000, contributions: [] }]));
    await expect(s.contribute('u1', 'p1', { contributorId: 'c1', name: 'x', amount: 1000 })).rejects.toThrow('abierta');
  });

  it('rejects expired contribution', async () => {
    const pastDeadline = new Date(Date.now() - 86400000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'p1', status: 'OPEN', deadline: pastDeadline, currentAmount: 0, targetAmount: 100000, contributions: [] }]));
    await expect(s.contribute('u1', 'p1', { contributorId: 'c1', name: 'x', amount: 1000 })).rejects.toThrow('expirada');
  });

  it('closes pot manually', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'p1', status: 'OPEN' }]));
    const p = await s.close('u1', 'p1');
    expect(p?.status).toBe('CLOSED');
  });

  it('cancels pot', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'p1', status: 'OPEN' }]));
    const p = await s.cancel('u1', 'p1');
    expect(p?.status).toBe('CANCELLED');
  });

  it('counts unique contributors', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'p1', contributions: [
      { contributorId: 'c1' }, { contributorId: 'c2' }, { contributorId: 'c1' }, { contributorId: 'c3' },
    ]}]));
    expect(await s.getContributorCount('u1', 'p1')).toBe(3);
  });

  it('computes progress percentage', () => {
    const p = s.computeProgress({ id: 'p1', ownerId: 'u1', title: 'x', description: '', targetAmount: 100000, currentAmount: 25000, status: 'OPEN', contributions: [], createdAt: '' });
    expect(p).toBe(25);
  });

  it('caps progress at 100', () => {
    const p = s.computeProgress({ id: 'p1', ownerId: 'u1', title: 'x', description: '', targetAmount: 100000, currentAmount: 150000, status: 'OPEN', contributions: [], createdAt: '' });
    expect(p).toBe(100);
  });
});
