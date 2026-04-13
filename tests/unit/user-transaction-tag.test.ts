const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserTransactionTagService } from '../../src/services/user-transaction-tag.service';

describe('UserTransactionTagService', () => {
  let s: UserTransactionTagService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserTransactionTagService(); mockRedisGet.mockResolvedValue(null); });

  it('sets tags normalized', async () => {
    const t = await s.setTags('u1', 'tx1', ['Comida', 'RESTAURANT', 'comida']);
    expect(t.tags).toEqual(['comida', 'restaurant']);
  });

  it('normalizes spaces to hyphens', async () => {
    const t = await s.setTags('u1', 'tx1', ['Salida con amigos']);
    expect(t.tags).toEqual(['salida-con-amigos']);
  });

  it('rejects over 10 tags', async () => {
    const tags = Array.from({ length: 11 }, (_, i) => 'tag' + i);
    await expect(s.setTags('u1', 'tx1', tags)).rejects.toThrow('10 tags');
  });

  it('adds single tag', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ transactionId: 'tx1', tags: ['comida'], updatedAt: '' }]));
    const t = await s.addTag('u1', 'tx1', 'Delivery');
    expect(t.tags).toContain('delivery');
    expect(t.tags).toContain('comida');
  });

  it('rejects empty tag', async () => {
    await expect(s.addTag('u1', 'tx1', '   ')).rejects.toThrow('invalido');
  });

  it('removes tag', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ transactionId: 'tx1', tags: ['comida', 'delivery'], updatedAt: '' }]));
    expect(await s.removeTag('u1', 'tx1', 'delivery')).toBe(true);
  });

  it('returns false when tag not found', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ transactionId: 'tx1', tags: ['comida'], updatedAt: '' }]));
    expect(await s.removeTag('u1', 'tx1', 'inexistente')).toBe(false);
  });

  it('finds transactions by tag', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { transactionId: 'tx1', tags: ['comida'] },
      { transactionId: 'tx2', tags: ['transporte'] },
      { transactionId: 'tx3', tags: ['comida', 'delivery'] },
    ]));
    const found = await s.findByTag('u1', 'comida');
    expect(found).toEqual(['tx1', 'tx3']);
  });

  it('returns all tags sorted by count', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { transactionId: 'tx1', tags: ['comida'] },
      { transactionId: 'tx2', tags: ['comida', 'delivery'] },
      { transactionId: 'tx3', tags: ['comida', 'salud'] },
    ]));
    const all = await s.getAllTags('u1');
    expect(all[0]).toEqual({ tag: 'comida', count: 3 });
    expect(all.length).toBe(3);
  });
});
