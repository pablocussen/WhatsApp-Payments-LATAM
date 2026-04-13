const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantGiftCardService } from '../../src/services/merchant-gift-card.service';

describe('MerchantGiftCardService', () => {
  let s: MerchantGiftCardService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantGiftCardService(); mockRedisGet.mockResolvedValue(null); });

  const base = {
    merchantId: 'm1',
    buyerPhone: '+56912345678',
    faceValue: 25000,
  };

  it('issues gift card with balance equal to face value', async () => {
    const c = await s.issue(base);
    expect(c.balance).toBe(25000);
    expect(c.status).toBe('ACTIVE');
    expect(c.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('rejects out of range value', async () => {
    await expect(s.issue({ ...base, faceValue: 500 })).rejects.toThrow('1.000');
    await expect(s.issue({ ...base, faceValue: 999999 })).rejects.toThrow('500.000');
  });

  it('rejects invalid buyer phone', async () => {
    await expect(s.issue({ ...base, buyerPhone: 'abc' })).rejects.toThrow('comprador');
  });

  it('rejects long message', async () => {
    await expect(s.issue({ ...base, message: 'x'.repeat(201) })).rejects.toThrow('200');
  });

  it('finds by code', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { code: 'AAAA-BBBB-CCCC', id: 'g1' },
      { code: 'XXXX-YYYY-ZZZZ', id: 'g2' },
    ]));
    const c = await s.findByCode('m1', 'XXXX-YYYY-ZZZZ');
    expect(c?.id).toBe('g2');
  });

  it('redeems partial amount', async () => {
    const future = new Date(Date.now() + 30 * 86400000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      code: 'TEST-CODE-1234', status: 'ACTIVE', balance: 25000,
      faceValue: 25000, expiresAt: future, redemptions: [],
    }]));
    const c = await s.redeem('m1', 'TEST-CODE-1234', 10000);
    expect(c?.balance).toBe(15000);
    expect(c?.status).toBe('ACTIVE');
    expect(c?.redemptions).toHaveLength(1);
  });

  it('marks REDEEMED when balance reaches zero', async () => {
    const future = new Date(Date.now() + 30 * 86400000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      code: 'TEST-CODE-1234', status: 'ACTIVE', balance: 10000,
      faceValue: 25000, expiresAt: future, redemptions: [],
    }]));
    const c = await s.redeem('m1', 'TEST-CODE-1234', 10000);
    expect(c?.status).toBe('REDEEMED');
  });

  it('rejects redeem beyond balance', async () => {
    const future = new Date(Date.now() + 30 * 86400000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      code: 'TEST-CODE-1234', status: 'ACTIVE', balance: 5000,
      faceValue: 25000, expiresAt: future, redemptions: [],
    }]));
    await expect(s.redeem('m1', 'TEST-CODE-1234', 10000)).rejects.toThrow('insuficiente');
  });

  it('rejects expired redemption', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      code: 'TEST-CODE-1234', status: 'ACTIVE', balance: 25000,
      faceValue: 25000, expiresAt: past, redemptions: [],
    }]));
    await expect(s.redeem('m1', 'TEST-CODE-1234', 5000)).rejects.toThrow('expirada');
  });

  it('cancels active card', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ code: 'X', status: 'ACTIVE' }]));
    const c = await s.cancel('m1', 'X');
    expect(c?.status).toBe('CANCELLED');
  });

  it('rejects cancel on redeemed', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ code: 'X', status: 'REDEEMED' }]));
    await expect(s.cancel('m1', 'X')).rejects.toThrow('redimida');
  });

  it('computes stats', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'ACTIVE', faceValue: 10000, balance: 10000 },
      { status: 'ACTIVE', faceValue: 20000, balance: 5000 },
      { status: 'REDEEMED', faceValue: 30000, balance: 0 },
      { status: 'EXPIRED', faceValue: 15000, balance: 15000 },
    ]));
    const stats = await s.getStats('m1');
    expect(stats.issued).toBe(4);
    expect(stats.totalIssued).toBe(75000);
    expect(stats.totalRedeemed).toBe(45000);
    expect(stats.activeBalance).toBe(15000);
    expect(stats.expiredCount).toBe(1);
  });

  it('expires old cards', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'ACTIVE', expiresAt: past },
      { status: 'ACTIVE', expiresAt: future },
      { status: 'ACTIVE', expiresAt: past },
    ]));
    expect(await s.expireOld('m1')).toBe(2);
  });
});
