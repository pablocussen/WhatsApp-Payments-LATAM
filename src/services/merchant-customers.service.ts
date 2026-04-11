import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('merchant-customers');

const CUST_PREFIX = 'mcust:';
const CUST_TTL = 365 * 24 * 60 * 60;
const MAX_CUSTOMERS = 10000;

export interface MerchantCustomer {
  id: string;
  merchantId: string;
  phone: string;
  name: string | null;
  email: string | null;
  totalSpent: number;
  transactionCount: number;
  lastTransactionAt: string | null;
  firstSeenAt: string;
  tags: string[];
}

export class MerchantCustomersService {
  async addOrUpdate(merchantId: string, phone: string, amount: number, name?: string): Promise<MerchantCustomer> {
    const customers = await this.getCustomers(merchantId);
    let customer = customers.find(c => c.phone === phone);

    if (customer) {
      customer.totalSpent += amount;
      customer.transactionCount++;
      customer.lastTransactionAt = new Date().toISOString();
      if (name && !customer.name) customer.name = name;
    } else {
      if (customers.length >= MAX_CUSTOMERS) {
        throw new Error('Límite de clientes alcanzado.');
      }
      customer = {
        id: `cust_${Date.now().toString(36)}`,
        merchantId,
        phone,
        name: name ?? null,
        email: null,
        totalSpent: amount,
        transactionCount: 1,
        lastTransactionAt: new Date().toISOString(),
        firstSeenAt: new Date().toISOString(),
        tags: [],
      };
      customers.push(customer);
    }

    await this.save(merchantId, customers);
    return customer;
  }

  async getCustomers(merchantId: string): Promise<MerchantCustomer[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${CUST_PREFIX}${merchantId}`);
      return raw ? JSON.parse(raw) as MerchantCustomer[] : [];
    } catch {
      return [];
    }
  }

  async getTopCustomers(merchantId: string, limit = 10): Promise<MerchantCustomer[]> {
    const customers = await this.getCustomers(merchantId);
    return customers.sort((a, b) => b.totalSpent - a.totalSpent).slice(0, limit);
  }

  async getRecentCustomers(merchantId: string, limit = 10): Promise<MerchantCustomer[]> {
    const customers = await this.getCustomers(merchantId);
    return customers
      .filter(c => c.lastTransactionAt)
      .sort((a, b) => new Date(b.lastTransactionAt!).getTime() - new Date(a.lastTransactionAt!).getTime())
      .slice(0, limit);
  }

  async addTag(merchantId: string, customerId: string, tag: string): Promise<boolean> {
    const customers = await this.getCustomers(merchantId);
    const customer = customers.find(c => c.id === customerId);
    if (!customer) return false;
    if (customer.tags.includes(tag)) return true;
    if (customer.tags.length >= 10) return false;
    customer.tags.push(tag);
    await this.save(merchantId, customers);
    return true;
  }

  async searchCustomers(merchantId: string, query: string): Promise<MerchantCustomer[]> {
    const customers = await this.getCustomers(merchantId);
    const lower = query.toLowerCase();
    return customers.filter(c =>
      c.phone.includes(lower) ||
      c.name?.toLowerCase().includes(lower) ||
      c.tags.some(t => t.toLowerCase().includes(lower)),
    );
  }

  async getCustomerCount(merchantId: string): Promise<number> {
    const customers = await this.getCustomers(merchantId);
    return customers.length;
  }

  getCustomerSummary(c: MerchantCustomer): string {
    const parts = [c.name || c.phone, formatCLP(c.totalSpent), `${c.transactionCount} tx`];
    if (c.tags.length > 0) parts.push(c.tags.join(', '));
    return parts.join(' — ');
  }

  private async save(merchantId: string, customers: MerchantCustomer[]): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${CUST_PREFIX}${merchantId}`, JSON.stringify(customers), { EX: CUST_TTL });
    } catch (err) {
      log.warn('Failed to save customers', { merchantId, error: (err as Error).message });
    }
  }
}

export const merchantCustomers = new MerchantCustomersService();
