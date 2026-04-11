import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('exchange-rate');

const RATE_PREFIX = 'xrate:';
const RATE_TTL = 60 * 60; // 1 hour cache

export type Currency = 'CLP' | 'USD' | 'PEN' | 'ARS' | 'COP' | 'MXN' | 'UF';

// Base rates to CLP (updated manually or via API)
const DEFAULT_RATES: Record<Currency, number> = {
  CLP: 1,
  USD: 940,
  PEN: 250,
  ARS: 1.1,
  COP: 0.23,
  MXN: 55,
  UF: 37800,
};

export interface ExchangeRate {
  from: Currency;
  to: Currency;
  rate: number;
  updatedAt: string;
}

export class ExchangeRateService {
  /**
   * Get exchange rate between two currencies.
   */
  async getRate(from: Currency, to: Currency): Promise<number> {
    if (from === to) return 1;

    // Check cache
    try {
      const redis = getRedis();
      const cached = await redis.get(`${RATE_PREFIX}${from}:${to}`);
      if (cached) return parseFloat(cached);
    } catch { /* fallback to defaults */ }

    // Calculate from defaults (via CLP as base)
    const fromRate = DEFAULT_RATES[from];
    const toRate = DEFAULT_RATES[to];
    if (!fromRate || !toRate) throw new Error(`Moneda no soportada: ${from} o ${to}`);

    return fromRate / toRate;
  }

  /**
   * Convert amount between currencies.
   */
  async convert(amount: number, from: Currency, to: Currency): Promise<{ amount: number; rate: number; formatted: string }> {
    const rate = await this.getRate(from, to);
    const converted = Math.round(amount * rate);
    return {
      amount: converted,
      rate,
      formatted: to === 'CLP' ? formatCLP(converted) : `${converted.toLocaleString('es-CL')} ${to}`,
    };
  }

  /**
   * Set a custom rate (admin).
   */
  async setRate(from: Currency, to: Currency, rate: number): Promise<void> {
    if (rate <= 0) throw new Error('Tasa debe ser mayor a 0.');
    try {
      const redis = getRedis();
      await redis.set(`${RATE_PREFIX}${from}:${to}`, rate.toString(), { EX: RATE_TTL });
      await redis.set(`${RATE_PREFIX}${to}:${from}`, (1 / rate).toString(), { EX: RATE_TTL });
    } catch (err) {
      log.warn('Failed to set rate', { from, to, error: (err as Error).message });
    }
    log.info('Rate set', { from, to, rate });
  }

  /**
   * Get all rates relative to CLP.
   */
  async getAllRates(): Promise<ExchangeRate[]> {
    const currencies: Currency[] = ['USD', 'PEN', 'ARS', 'COP', 'MXN', 'UF'];
    const rates: ExchangeRate[] = [];

    for (const cur of currencies) {
      const rate = await this.getRate(cur, 'CLP');
      rates.push({
        from: cur,
        to: 'CLP',
        rate,
        updatedAt: new Date().toISOString(),
      });
    }

    return rates;
  }

  /**
   * Get supported currencies.
   */
  getSupportedCurrencies(): { code: Currency; name: string; symbol: string }[] {
    return [
      { code: 'CLP', name: 'Peso Chileno', symbol: '$' },
      { code: 'USD', name: 'Dólar Estadounidense', symbol: 'US$' },
      { code: 'PEN', name: 'Sol Peruano', symbol: 'S/' },
      { code: 'ARS', name: 'Peso Argentino', symbol: 'AR$' },
      { code: 'COP', name: 'Peso Colombiano', symbol: 'CO$' },
      { code: 'MXN', name: 'Peso Mexicano', symbol: 'MX$' },
      { code: 'UF', name: 'Unidad de Fomento', symbol: 'UF' },
    ];
  }
}

export const exchangeRates = new ExchangeRateService();
