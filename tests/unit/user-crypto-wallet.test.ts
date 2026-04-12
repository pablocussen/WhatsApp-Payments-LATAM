const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserCryptoWalletService } from '../../src/services/user-crypto-wallet.service';

describe('UserCryptoWalletService', () => {
  let s: UserCryptoWalletService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserCryptoWalletService(); mockRedisGet.mockResolvedValue(null); });

  it('creates BTC wallet', async () => {
    const w = await s.createWallet('u1', 'BTC');
    expect(w.currency).toBe('BTC');
    expect(w.address).toMatch(/^bc1/);
    expect(w.balance).toBe(0);
  });

  it('creates ETH wallet', async () => {
    const w = await s.createWallet('u1', 'ETH');
    expect(w.address).toMatch(/^0x/);
    expect(w.address).toHaveLength(42);
  });

  it('rejects invalid currency', async () => {
    await expect(s.createWallet('u1', 'XYZ' as any)).rejects.toThrow('soportada');
  });

  it('rejects duplicate wallet', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ userId: 'u1', currency: 'BTC' }));
    await expect(s.createWallet('u1', 'BTC')).rejects.toThrow('Ya existe');
  });

  it('returns null for missing', async () => {
    expect(await s.getWallet('u1', 'BTC')).toBeNull();
  });

  it('deposits', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ userId: 'u1', currency: 'USDT', balance: 100, totalDeposited: 100, totalWithdrawn: 0, active: true }));
    expect(await s.deposit('u1', 'USDT', 50)).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.balance).toBe(150);
    expect(saved.totalDeposited).toBe(150);
  });

  it('rejects negative deposit', async () => {
    await expect(s.deposit('u1', 'BTC', -1)).rejects.toThrow('positivo');
  });

  it('withdraws', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ userId: 'u1', currency: 'USDT', balance: 100, totalDeposited: 100, totalWithdrawn: 0, active: true }));
    expect(await s.withdraw('u1', 'USDT', 30)).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.balance).toBe(70);
    expect(saved.totalWithdrawn).toBe(30);
  });

  it('rejects overdraft', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ userId: 'u1', currency: 'BTC', balance: 10, active: true }));
    await expect(s.withdraw('u1', 'BTC', 50)).rejects.toThrow('insuficiente');
  });
});
