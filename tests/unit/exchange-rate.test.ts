/**
 * ExchangeRateService — tasas de cambio multi-moneda.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { ExchangeRateService } from '../../src/services/exchange-rate.service';

describe('ExchangeRateService', () => {
  let service: ExchangeRateService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ExchangeRateService();
    mockRedisGet.mockResolvedValue(null);
  });

  it('returns 1 for same currency', async () => {
    expect(await service.getRate('CLP', 'CLP')).toBe(1);
  });

  it('returns USD to CLP rate', async () => {
    const rate = await service.getRate('USD', 'CLP');
    expect(rate).toBe(940);
  });

  it('returns CLP to USD rate', async () => {
    const rate = await service.getRate('CLP', 'USD');
    expect(rate).toBeCloseTo(1 / 940, 5);
  });

  it('uses cached rate if available', async () => {
    mockRedisGet.mockResolvedValue('950');
    const rate = await service.getRate('USD', 'CLP');
    expect(rate).toBe(950);
  });

  it('converts USD to CLP', async () => {
    const result = await service.convert(100, 'USD', 'CLP');
    expect(result.amount).toBe(94000);
    expect(result.formatted).toContain('$94.000');
  });

  it('converts CLP to USD', async () => {
    const result = await service.convert(94000, 'CLP', 'USD');
    expect(result.amount).toBe(100);
  });

  it('converts UF to CLP', async () => {
    const result = await service.convert(1, 'UF', 'CLP');
    expect(result.amount).toBe(37800);
  });

  it('sets custom rate', async () => {
    await service.setRate('USD', 'CLP', 950);
    expect(mockRedisSet).toHaveBeenCalledTimes(2);
    expect(mockRedisSet.mock.calls[0][1]).toBe('950');
  });

  it('rejects negative rate', async () => {
    await expect(service.setRate('USD', 'CLP', -1)).rejects.toThrow('mayor a 0');
  });

  it('returns all rates', async () => {
    const rates = await service.getAllRates();
    expect(rates.length).toBe(6);
    const usd = rates.find(r => r.from === 'USD');
    expect(usd?.rate).toBe(940);
  });

  it('returns supported currencies', () => {
    const currencies = service.getSupportedCurrencies();
    expect(currencies).toHaveLength(7);
    expect(currencies.find(c => c.code === 'CLP')?.name).toBe('Peso Chileno');
    expect(currencies.find(c => c.code === 'UF')?.symbol).toBe('UF');
  });
});
