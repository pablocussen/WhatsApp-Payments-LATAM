const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserTrustCircleService } from '../../src/services/user-trust-circle.service';

describe('UserTrustCircleService', () => {
  let s: UserTrustCircleService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserTrustCircleService(); mockRedisGet.mockResolvedValue(null); });

  it('adds family contact with 5x multiplier', async () => {
    const c = await s.add({ userId: 'u1', contactId: 'c1', phone: '+56912345678', name: 'Mama', level: 'FAMILY' });
    expect(c.limitMultiplier).toBe(5);
    expect(c.allowHigherLimits).toBe(true);
  });

  it('adds business contact with 2x multiplier', async () => {
    const c = await s.add({ userId: 'u1', contactId: 'c1', phone: '+56912345678', name: 'Proveedor', level: 'BUSINESS' });
    expect(c.limitMultiplier).toBe(2);
  });

  it('rejects invalid phone', async () => {
    await expect(s.add({ userId: 'u1', contactId: 'c1', phone: 'abc', name: 'x', level: 'FRIEND' })).rejects.toThrow('Telefono');
  });

  it('rejects duplicate contact', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ contactId: 'c1' }]));
    await expect(s.add({ userId: 'u1', contactId: 'c1', phone: '+56912345678', name: 'x', level: 'FRIEND' })).rejects.toThrow('ya en');
  });

  it('rejects over 50 contacts', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(Array.from({ length: 50 }, (_, i) => ({ contactId: 'c' + i }))));
    await expect(s.add({ userId: 'u1', contactId: 'new', phone: '+56912345678', name: 'x', level: 'FRIEND' })).rejects.toThrow('50');
  });

  it('updates level and multiplier', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ contactId: 'c1', level: 'FRIEND', limitMultiplier: 3 }]));
    const c = await s.updateLevel('u1', 'c1', 'FAMILY');
    expect(c?.level).toBe('FAMILY');
    expect(c?.limitMultiplier).toBe(5);
  });

  it('removes contact', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ contactId: 'c1' }, { contactId: 'c2' }]));
    expect(await s.remove('u1', 'c1')).toBe(true);
  });

  it('records transaction', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ contactId: 'c1', transactionCount: 3 }]));
    const c = await s.recordTransaction('u1', 'c1');
    expect(c?.transactionCount).toBe(4);
    expect(c?.lastTransactionAt).toBeDefined();
  });

  it('checks if contact trusted', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ contactId: 'c1' }]));
    expect(await s.isTrusted('u1', 'c1')).toBe(true);
    expect(await s.isTrusted('u1', 'nope')).toBe(false);
  });

  it('returns multiplier 1 when not trusted', async () => {
    expect(await s.getLimitMultiplier('u1', 'c1')).toBe(1);
  });

  it('returns multiplier 1 when limits disabled', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ contactId: 'c1', allowHigherLimits: false, limitMultiplier: 5 }]));
    expect(await s.getLimitMultiplier('u1', 'c1')).toBe(1);
  });

  it('filters by level', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { contactId: 'c1', level: 'FAMILY' },
      { contactId: 'c2', level: 'FRIEND' },
      { contactId: 'c3', level: 'FAMILY' },
    ]));
    const family = await s.getByLevel('u1', 'FAMILY');
    expect(family).toHaveLength(2);
  });
});
