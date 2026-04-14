import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-currency-exchange');
const PREFIX = 'user:currency-exchange:';
const TTL = 365 * 24 * 60 * 60;

export type Currency = 'CLP' | 'USD' | 'EUR' | 'ARS' | 'PEN' | 'BRL';

export interface ExchangeOrder {
  id: string;
  userId: string;
  fromCurrency: Currency;
  toCurrency: Currency;
  fromAmount: number;
  toAmount: number;
  exchangeRate: number;
  feePercent: number;
  feeAmount: number;
  status: 'PENDING' | 'EXECUTED' | 'CANCELLED';
  createdAt: string;
  executedAt?: string;
}

const STATIC_RATES: Record<string, number> = {
  'USD_CLP': 950,
  'CLP_USD': 1 / 950,
  'EUR_CLP': 1020,
  'CLP_EUR': 1 / 1020,
  'ARS_CLP': 1.1,
  'CLP_ARS': 1 / 1.1,
  'PEN_CLP': 253,
  'CLP_PEN': 1 / 253,
  'BRL_CLP': 190,
  'CLP_BRL': 1 / 190,
};

export class UserCurrencyExchangeService {
  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  private pairKey(from: Currency, to: Currency): string {
    return `${from}_${to}`;
  }

  getRate(from: Currency, to: Currency): number {
    if (from === to) return 1;
    const rate = STATIC_RATES[this.pairKey(from, to)];
    if (rate === undefined) throw new Error(`Par ${from}/${to} no soportado`);
    return rate;
  }

  async list(userId: string): Promise<ExchangeOrder[]> {
    const raw = await getRedis().get(this.key(userId));
    return raw ? JSON.parse(raw) : [];
  }

  async quote(input: {
    fromCurrency: Currency;
    toCurrency: Currency;
    fromAmount: number;
  }): Promise<{ rate: number; toAmount: number; feePercent: number; feeAmount: number; netAmount: number }> {
    if (input.fromAmount <= 0) throw new Error('Monto debe ser positivo');
    if (input.fromCurrency === input.toCurrency) throw new Error('Monedas deben ser diferentes');
    const rate = this.getRate(input.fromCurrency, input.toCurrency);
    const grossAmount = input.fromAmount * rate;
    const feePercent = 1.5;
    const feeAmount = Math.round(grossAmount * (feePercent / 100));
    return {
      rate,
      toAmount: Math.round(grossAmount),
      feePercent,
      feeAmount,
      netAmount: Math.round(grossAmount) - feeAmount,
    };
  }

  async createOrder(input: {
    userId: string;
    fromCurrency: Currency;
    toCurrency: Currency;
    fromAmount: number;
  }): Promise<ExchangeOrder> {
    const quote = await this.quote(input);
    const list = await this.list(input.userId);
    const pending = list.filter(o => o.status === 'PENDING');
    if (pending.length >= 10) throw new Error('Maximo 10 ordenes pendientes');
    const order: ExchangeOrder = {
      id: `fx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      userId: input.userId,
      fromCurrency: input.fromCurrency,
      toCurrency: input.toCurrency,
      fromAmount: input.fromAmount,
      toAmount: quote.netAmount,
      exchangeRate: quote.rate,
      feePercent: quote.feePercent,
      feeAmount: quote.feeAmount,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };
    list.push(order);
    await getRedis().set(this.key(input.userId), JSON.stringify(list), { EX: TTL });
    log.info('exchange order created', { id: order.id });
    return order;
  }

  async execute(userId: string, id: string): Promise<ExchangeOrder | null> {
    const list = await this.list(userId);
    const order = list.find(o => o.id === id);
    if (!order) return null;
    if (order.status !== 'PENDING') throw new Error('Solo se puede ejecutar ordenes pendientes');
    order.status = 'EXECUTED';
    order.executedAt = new Date().toISOString();
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return order;
  }

  async cancel(userId: string, id: string): Promise<ExchangeOrder | null> {
    const list = await this.list(userId);
    const order = list.find(o => o.id === id);
    if (!order) return null;
    if (order.status !== 'PENDING') throw new Error('Solo se puede cancelar ordenes pendientes');
    order.status = 'CANCELLED';
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return order;
  }

  async getVolumeByDirection(userId: string): Promise<Record<string, number>> {
    const list = await this.list(userId);
    const volumes: Record<string, number> = {};
    for (const o of list.filter(x => x.status === 'EXECUTED')) {
      const key = `${o.fromCurrency}_${o.toCurrency}`;
      volumes[key] = (volumes[key] ?? 0) + o.fromAmount;
    }
    return volumes;
  }
}

export const userCurrencyExchange = new UserCurrencyExchangeService();
