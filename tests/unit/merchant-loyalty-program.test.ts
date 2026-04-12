const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantLoyaltyProgramService } from '../../src/services/merchant-loyalty-program.service';

describe('MerchantLoyaltyProgramService', () => {
  let s: MerchantLoyaltyProgramService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantLoyaltyProgramService(); mockRedisGet.mockResolvedValue(null); });

  it('creates program with defaults', async () => {
    const p = await s.createProgram({ merchantId: 'm1', name: 'Puntos VIP', type: 'POINTS_PER_PURCHASE' });
    expect(p.id).toMatch(/^loy_/);
    expect(p.pointsPerCLP).toBe(0.01);
    expect(p.minRedeemPoints).toBe(100);
  });

  it('rejects empty name', async () => {
    await expect(s.createProgram({ merchantId: 'm1', name: '', type: 'POINTS_PER_PURCHASE' })).rejects.toThrow('Nombre');
  });

  it('enrolls customer', async () => {
    const e = await s.enrollCustomer('p1', 'c1');
    expect(e.points).toBe(0);
    expect(e.customerId).toBe('c1');
  });

  it('earns points on purchase', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('loyprog:cust:')) return Promise.resolve(JSON.stringify({ customerId: 'c1', programId: 'p1', points: 10, totalEarned: 10, totalRedeemed: 0 }));
      return Promise.resolve(JSON.stringify({ id: 'p1', pointsPerCLP: 0.01, minRedeemPoints: 100, pointToValueRate: 1 }));
    });
    const e = await s.earnPoints('p1', 'c1', 50000);
    expect(e?.points).toBe(510);
    expect(e?.totalEarned).toBe(510);
  });

  it('redeems points', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('loyprog:cust:')) return Promise.resolve(JSON.stringify({ customerId: 'c1', programId: 'p1', points: 500, totalEarned: 500, totalRedeemed: 0 }));
      return Promise.resolve(JSON.stringify({ id: 'p1', pointsPerCLP: 0.01, minRedeemPoints: 100, pointToValueRate: 2 }));
    });
    const r = await s.redeemPoints('p1', 'c1', 200);
    expect(r.success).toBe(true);
    expect(r.valueGiven).toBe(400);
  });

  it('rejects below min redeem', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('loyprog:cust:')) return Promise.resolve(JSON.stringify({ points: 500 }));
      return Promise.resolve(JSON.stringify({ minRedeemPoints: 100, pointToValueRate: 1 }));
    });
    const r = await s.redeemPoints('p1', 'c1', 50);
    expect(r.success).toBe(false);
    expect(r.error).toContain('Minimo');
  });

  it('rejects insufficient points', async () => {
    mockRedisGet.mockImplementation((key: string) => {
      if (key.startsWith('loyprog:cust:')) return Promise.resolve(JSON.stringify({ points: 50 }));
      return Promise.resolve(JSON.stringify({ minRedeemPoints: 10, pointToValueRate: 1 }));
    });
    const r = await s.redeemPoints('p1', 'c1', 100);
    expect(r.success).toBe(false);
    expect(r.error).toContain('insuficientes');
  });

  it('returns null for missing program', async () => {
    expect(await s.getProgram('nope')).toBeNull();
  });
});
