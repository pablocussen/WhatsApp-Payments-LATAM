import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('currency-service');

// ─── Types ──────────────────────────────────────────────

export type SupportedCurrency = 'CLP' | 'USD' | 'PEN' | 'ARS' | 'COP' | 'MXN';

export interface ExchangeRate {
  from: SupportedCurrency;
  to: SupportedCurrency;
  rate: number;       // 1 unit of `from` = `rate` units of `to`
  updatedAt: string;
}

export interface ConversionResult {
  from: { amount: number; currency: SupportedCurrency };
  to: { amount: number; currency: SupportedCurrency };
  rate: number;
}

// ─── Default Rates (CLP base, updated manually until API integration) ────

const DEFAULT_RATES: Record<string, number> = {
  // From CLP to X (how many units of X per 1 CLP)
  'CLP:USD': 0.001050,
  'CLP:PEN': 0.003900,
  'CLP:ARS': 1.250000,
  'CLP:COP': 4.400000,
  'CLP:MXN': 0.018000,
  // From X to CLP (how many CLP per 1 unit of X)
  'USD:CLP': 952.38,
  'PEN:CLP': 256.41,
  'ARS:CLP': 0.80,
  'COP:CLP': 0.2273,
  'MXN:CLP': 55.56,
};

const RATE_CACHE_KEY = 'exchange-rates';
const RATE_TTL = 3600; // 1 hour cache

// ─── Service ────────────────────────────────────────────

export class CurrencyService {
  private readonly currencies: SupportedCurrency[] = ['CLP', 'USD', 'PEN', 'ARS', 'COP', 'MXN'];

  getSupportedCurrencies(): SupportedCurrency[] {
    return [...this.currencies];
  }

  /**
   * Get all available exchange rates.
   * Tries Redis cache first, falls back to default rates.
   */
  async getRates(): Promise<Record<string, number>> {
    try {
      const redis = getRedis();
      const cached = await redis.get(RATE_CACHE_KEY);
      if (cached) return JSON.parse(cached) as Record<string, number>;
    } catch {
      // Redis unavailable, use defaults
    }
    return { ...DEFAULT_RATES };
  }

  /**
   * Get exchange rate between two currencies.
   * Tries Redis cache first, falls back to default rates.
   */
  async getRate(from: SupportedCurrency, to: SupportedCurrency): Promise<number> {
    if (from === to) return 1;

    // Try cached rates
    try {
      const redis = getRedis();
      const cached = await redis.get(RATE_CACHE_KEY);
      if (cached) {
        const rates = JSON.parse(cached) as Record<string, number>;
        const key = `${from}:${to}`;
        if (rates[key] != null) return rates[key];
      }
    } catch {
      // Redis unavailable, use defaults
    }

    // Direct rate
    const directKey = `${from}:${to}`;
    if (DEFAULT_RATES[directKey] != null) return DEFAULT_RATES[directKey];

    // Cross-rate via CLP
    if (from !== 'CLP' && to !== 'CLP') {
      const toCLP = DEFAULT_RATES[`${from}:CLP`];
      const fromCLP = DEFAULT_RATES[`CLP:${to}`];
      if (toCLP != null && fromCLP != null) return toCLP * fromCLP;
    }

    throw new Error(`No exchange rate available for ${from}→${to}`);
  }

  /**
   * Convert an amount between currencies.
   * Returns the converted amount rounded to the target currency's precision.
   */
  async convert(
    amount: number,
    from: SupportedCurrency,
    to: SupportedCurrency,
  ): Promise<ConversionResult> {
    if (amount < 0) throw new Error('Amount must be non-negative');

    const rate = await this.getRate(from, to);
    const converted = this.round(amount * rate, to);

    return {
      from: { amount, currency: from },
      to: { amount: converted, currency: to },
      rate,
    };
  }

  /**
   * Round to appropriate precision for the currency.
   * CLP/ARS/COP = 0 decimals, USD/PEN/MXN = 2 decimals.
   */
  private round(amount: number, currency: SupportedCurrency): number {
    const zeroDecimalCurrencies: SupportedCurrency[] = ['CLP', 'ARS', 'COP'];
    if (zeroDecimalCurrencies.includes(currency)) {
      return Math.round(amount);
    }
    return Math.round(amount * 100) / 100;
  }

  /**
   * Format amount in locale-appropriate format.
   */
  formatAmount(amount: number, currency: SupportedCurrency): string {
    const locales: Record<SupportedCurrency, string> = {
      CLP: 'es-CL',
      USD: 'en-US',
      PEN: 'es-PE',
      ARS: 'es-AR',
      COP: 'es-CO',
      MXN: 'es-MX',
    };

    return new Intl.NumberFormat(locales[currency], {
      style: 'currency',
      currency,
      minimumFractionDigits: ['CLP', 'ARS', 'COP'].includes(currency) ? 0 : 2,
    }).format(amount);
  }

  /**
   * Update cached exchange rates from an external source.
   * Called periodically or when rates are fetched from an API.
   */
  async updateRates(rates: Record<string, number>): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(RATE_CACHE_KEY, JSON.stringify(rates), { EX: RATE_TTL });
      log.info('Exchange rates updated', { pairs: Object.keys(rates).length });
    } catch (err) {
      log.warn('Failed to cache exchange rates', { error: (err as Error).message });
    }
  }
}

export const currency = new CurrencyService();
