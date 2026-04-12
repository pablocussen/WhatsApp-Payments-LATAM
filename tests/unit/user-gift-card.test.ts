const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserGiftCardService } from '../../src/services/user-gift-card.service';

describe('UserGiftCardService', () => {
  let s: UserGiftCardService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserGiftCardService(); mockRedisGet.mockResolvedValue(null); });

  it('creates gift card', async () => {
    const c = await s.createGiftCard({ purchaserId: 'u1', amount: 50000 });
    expect(c.id).toMatch(/^gc_/);
    expect(c.code).toHaveLength(16);
    expect(c.balance).toBe(50000);
    expect(c.status).toBe('ACTIVE');
  });

  it('rejects below min', async () => {
    await expect(s.createGiftCard({ purchaserId: 'u1', amount: 500 })).rejects.toThrow('1.000');
  });

  it('rejects above max', async () => {
    await expect(s.createGiftCard({ purchaserId: 'u1', amount: 600000 })).rejects.toThrow('500.000');
  });

  it('redeems partial', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify({ code: 'X', status: 'ACTIVE', balance: 50000, expiresAt: future }));
    const r = await s.redeemGiftCard('X', 20000);
    expect(r.success).toBe(true);
    expect(r.balance).toBe(30000);
  });

  it('redeems full and marks REDEEMED', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify({ code: 'X', status: 'ACTIVE', balance: 30000, expiresAt: future }));
    await s.redeemGiftCard('X', 30000);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.status).toBe('REDEEMED');
  });

  it('rejects expired', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ code: 'X', status: 'ACTIVE', balance: 10000, expiresAt: '2020-01-01' }));
    const r = await s.redeemGiftCard('X', 5000);
    expect(r.success).toBe(false);
  });

  it('rejects insufficient', async () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify({ code: 'X', status: 'ACTIVE', balance: 5000, expiresAt: future }));
    const r = await s.redeemGiftCard('X', 10000);
    expect(r.success).toBe(false);
    expect(r.error).toContain('insuficiente');
  });

  it('cancels gift card', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ code: 'X', status: 'ACTIVE' }));
    expect(await s.cancelGiftCard('X')).toBe(true);
  });

  it('formats summary', () => {
    const f = s.formatCardSummary({ code: 'ABC123', balance: 30000, amount: 50000, status: 'ACTIVE' } as any);
    expect(f).toContain('ABC123');
    expect(f).toContain('$30.000');
  });
});
