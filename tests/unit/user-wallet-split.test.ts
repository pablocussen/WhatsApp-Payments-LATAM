const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserWalletSplitService } from '../../src/services/user-wallet-split.service';

describe('UserWalletSplitService', () => {
  let s: UserWalletSplitService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserWalletSplitService(); mockRedisGet.mockResolvedValue(null); });

  it('creates sub-account', async () => {
    const sub = await s.createSubAccount({ userId: 'u1', name: 'Vacaciones', emoji: '🏖️', purpose: 'Ahorro vacaciones', color: '#06b6d4' });
    expect(sub.id).toMatch(/^sub_/);
    expect(sub.balance).toBe(0);
    expect(sub.active).toBe(true);
  });

  it('rejects over 10 sub-accounts', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ id: 's' + i }))));
    await expect(s.createSubAccount({ userId: 'u1', name: 'X', emoji: '💰', purpose: 'X', color: '#000' })).rejects.toThrow('10');
  });

  it('transfers between sub-accounts', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 's1', balance: 50000 },
      { id: 's2', balance: 10000 },
    ]));
    const r = await s.transfer('u1', 's1', 's2', 20000);
    expect(r.success).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].balance).toBe(30000);
    expect(saved[1].balance).toBe(30000);
  });

  it('rejects insufficient transfer', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 's1', balance: 5000 },
      { id: 's2', balance: 0 },
    ]));
    const r = await s.transfer('u1', 's1', 's2', 10000);
    expect(r.success).toBe(false);
    expect(r.error).toContain('insuficiente');
  });

  it('deposits', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 's1', balance: 10000 }]));
    expect(await s.deposit('u1', 's1', 5000)).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].balance).toBe(15000);
  });

  it('withdraws', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 's1', balance: 10000 }]));
    expect(await s.withdraw('u1', 's1', 3000)).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].balance).toBe(7000);
  });

  it('rejects over-withdraw', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 's1', balance: 5000 }]));
    expect(await s.withdraw('u1', 's1', 10000)).toBe(false);
  });

  it('calculates total balance', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { balance: 10000 }, { balance: 20000 }, { balance: 5000 },
    ]));
    expect(await s.getTotalBalance('u1')).toBe(35000);
  });

  it('formats summary', () => {
    const f = s.formatSubSummary({ emoji: '🏖️', name: 'Vacaciones', balance: 150000, purpose: 'Ahorro' } as any);
    expect(f).toContain('Vacaciones');
    expect(f).toContain('$150.000');
    expect(f).toContain('Ahorro');
  });
});
