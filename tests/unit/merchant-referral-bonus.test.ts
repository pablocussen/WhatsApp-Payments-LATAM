const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantReferralBonusService } from '../../src/services/merchant-referral-bonus.service';

describe('MerchantReferralBonusService', () => {
  let s: MerchantReferralBonusService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantReferralBonusService(); mockRedisGet.mockResolvedValue(null); });

  it('creates referral with default bonus', async () => {
    const r = await s.create({ referrerId: 'm1', referredId: 'm2', referredName: 'Kiosco Juan' });
    expect(r.bonusAmount).toBe(15000);
    expect(r.status).toBe('PENDING');
    expect(r.minTransactions).toBe(10);
  });

  it('rejects invalid bonus amount', async () => {
    await expect(s.create({ referrerId: 'm1', referredId: 'm2', referredName: 'x', bonusAmount: 500 })).rejects.toThrow('1.000');
    await expect(s.create({ referrerId: 'm1', referredId: 'm2', referredName: 'x', bonusAmount: 200000 })).rejects.toThrow('100.000');
  });

  it('rejects duplicate referred', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ referredId: 'm2' }]));
    await expect(s.create({ referrerId: 'm1', referredId: 'm2', referredName: 'x' })).rejects.toThrow('ya referido');
  });

  it('increments tx and pays on threshold', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'r1', referredId: 'm2', status: 'PENDING', minTransactions: 3, currentTransactions: 2, bonusAmount: 15000 }]));
    const r = await s.incrementTx('m1', 'm2');
    expect(r?.status).toBe('PAID');
    expect(r?.paidAt).toBeDefined();
  });

  it('does not pay before threshold', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'r1', referredId: 'm2', status: 'PENDING', minTransactions: 10, currentTransactions: 5, bonusAmount: 15000 }]));
    const r = await s.incrementTx('m1', 'm2');
    expect(r?.status).toBe('PENDING');
    expect(r?.currentTransactions).toBe(6);
  });

  it('cancels pending referral', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'r1', status: 'PENDING' }]));
    expect(await s.cancel('m1', 'r1')).toBe(true);
  });

  it('sums total earned', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'PAID', bonusAmount: 15000 },
      { status: 'PAID', bonusAmount: 25000 },
      { status: 'PENDING', bonusAmount: 10000 },
    ]));
    expect(await s.getTotalEarned('m1')).toBe(40000);
  });

  it('counts pending', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'PENDING' }, { status: 'PENDING' }, { status: 'PAID' },
    ]));
    expect(await s.getPendingCount('m1')).toBe(2);
  });
});
