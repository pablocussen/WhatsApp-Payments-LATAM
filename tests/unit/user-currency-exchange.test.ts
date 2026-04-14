const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserCurrencyExchangeService } from '../../src/services/user-currency-exchange.service';

describe('UserCurrencyExchangeService', () => {
  let s: UserCurrencyExchangeService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserCurrencyExchangeService(); mockRedisGet.mockResolvedValue(null); });

  it('returns rate 1 for same currency', () => {
    expect(s.getRate('CLP', 'CLP')).toBe(1);
  });

  it('returns USD_CLP rate', () => {
    expect(s.getRate('USD', 'CLP')).toBe(950);
  });

  it('rejects unsupported pair', () => {
    expect(() => s.getRate('EUR', 'USD')).toThrow('no soportado');
  });

  it('quotes exchange with fee', async () => {
    const q = await s.quote({ fromCurrency: 'USD', toCurrency: 'CLP', fromAmount: 100 });
    expect(q.rate).toBe(950);
    expect(q.toAmount).toBe(95000);
    expect(q.feePercent).toBe(1.5);
    expect(q.feeAmount).toBe(1425);
    expect(q.netAmount).toBe(93575);
  });

  it('rejects quote for same currency', async () => {
    await expect(s.quote({ fromCurrency: 'CLP', toCurrency: 'CLP', fromAmount: 1000 })).rejects.toThrow('diferentes');
  });

  it('rejects quote with zero amount', async () => {
    await expect(s.quote({ fromCurrency: 'USD', toCurrency: 'CLP', fromAmount: 0 })).rejects.toThrow('positivo');
  });

  it('creates order', async () => {
    const o = await s.createOrder({ userId: 'u1', fromCurrency: 'USD', toCurrency: 'CLP', fromAmount: 100 });
    expect(o.status).toBe('PENDING');
    expect(o.toAmount).toBe(93575);
  });

  it('rejects over 10 pending orders', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ id: 'fx' + i, status: 'PENDING' }))));
    await expect(s.createOrder({ userId: 'u1', fromCurrency: 'USD', toCurrency: 'CLP', fromAmount: 100 })).rejects.toThrow('10');
  });

  it('executes pending order', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'o1', status: 'PENDING' }]));
    const o = await s.execute('u1', 'o1');
    expect(o?.status).toBe('EXECUTED');
    expect(o?.executedAt).toBeDefined();
  });

  it('rejects execute on non-pending', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'o1', status: 'EXECUTED' }]));
    await expect(s.execute('u1', 'o1')).rejects.toThrow('pendientes');
  });

  it('cancels pending order', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'o1', status: 'PENDING' }]));
    const o = await s.cancel('u1', 'o1');
    expect(o?.status).toBe('CANCELLED');
  });

  it('computes volume by direction', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'EXECUTED', fromCurrency: 'USD', toCurrency: 'CLP', fromAmount: 100 },
      { status: 'EXECUTED', fromCurrency: 'USD', toCurrency: 'CLP', fromAmount: 200 },
      { status: 'EXECUTED', fromCurrency: 'EUR', toCurrency: 'CLP', fromAmount: 50 },
      { status: 'PENDING', fromCurrency: 'USD', toCurrency: 'CLP', fromAmount: 999 },
    ]));
    const vol = await s.getVolumeByDirection('u1');
    expect(vol['USD_CLP']).toBe(300);
    expect(vol['EUR_CLP']).toBe(50);
  });
});
