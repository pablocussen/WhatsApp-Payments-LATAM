import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-deposit-reconciliation');
const PREFIX = 'merchant:deposit-recon:';
const TTL = 180 * 24 * 60 * 60;

export type ReconStatus = 'PENDING' | 'MATCHED' | 'UNMATCHED' | 'DISPUTED';

export interface ExpectedDeposit {
  id: string;
  merchantId: string;
  expectedAmount: number;
  expectedDate: string;
  source: string;
  reference: string;
  status: ReconStatus;
  matchedTransactionId?: string;
  matchedAt?: string;
  notes?: string;
  createdAt: string;
}

export class MerchantDepositReconciliationService {
  private key(merchantId: string): string {
    return `${PREFIX}${merchantId}`;
  }

  async list(merchantId: string): Promise<ExpectedDeposit[]> {
    const raw = await getRedis().get(this.key(merchantId));
    return raw ? JSON.parse(raw) : [];
  }

  async expectDeposit(input: {
    merchantId: string;
    expectedAmount: number;
    expectedDate: string;
    source: string;
    reference: string;
    notes?: string;
  }): Promise<ExpectedDeposit> {
    if (input.expectedAmount <= 0) throw new Error('Monto debe ser positivo');
    if (input.source.length > 60) throw new Error('Fuente excede 60 caracteres');
    if (!input.reference) throw new Error('Referencia requerida');
    if (isNaN(new Date(input.expectedDate).getTime())) throw new Error('Fecha invalida');
    const list = await this.list(input.merchantId);
    if (list.some(d => d.reference === input.reference && d.status !== 'UNMATCHED')) {
      throw new Error('Ya existe deposito con esa referencia');
    }
    const deposit: ExpectedDeposit = {
      id: `dep_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      merchantId: input.merchantId,
      expectedAmount: input.expectedAmount,
      expectedDate: input.expectedDate,
      source: input.source,
      reference: input.reference,
      status: 'PENDING',
      notes: input.notes,
      createdAt: new Date().toISOString(),
    };
    list.push(deposit);
    if (list.length > 2000) list.splice(0, list.length - 2000);
    await getRedis().set(this.key(input.merchantId), JSON.stringify(list), { EX: TTL });
    log.info('expected deposit created', { id: deposit.id });
    return deposit;
  }

  async matchTransaction(
    merchantId: string,
    id: string,
    transactionId: string,
    actualAmount: number,
    tolerancePercent = 1,
  ): Promise<ExpectedDeposit | null> {
    const list = await this.list(merchantId);
    const deposit = list.find(d => d.id === id);
    if (!deposit) return null;
    if (deposit.status === 'MATCHED') throw new Error('Deposito ya esta conciliado');
    const tolerance = deposit.expectedAmount * (tolerancePercent / 100);
    const diff = Math.abs(actualAmount - deposit.expectedAmount);
    if (diff > tolerance) {
      deposit.status = 'DISPUTED';
      deposit.notes = `Diferencia: esperado ${deposit.expectedAmount}, actual ${actualAmount}`;
    } else {
      deposit.status = 'MATCHED';
      deposit.matchedTransactionId = transactionId;
      deposit.matchedAt = new Date().toISOString();
    }
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    log.info('deposit match attempted', { id, status: deposit.status });
    return deposit;
  }

  async markUnmatched(merchantId: string, id: string, reason: string): Promise<ExpectedDeposit | null> {
    const list = await this.list(merchantId);
    const deposit = list.find(d => d.id === id);
    if (!deposit) return null;
    if (deposit.status === 'MATCHED') throw new Error('No se puede desmarcar deposito conciliado');
    deposit.status = 'UNMATCHED';
    deposit.notes = reason;
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return deposit;
  }

  async getPending(merchantId: string): Promise<ExpectedDeposit[]> {
    const list = await this.list(merchantId);
    return list
      .filter(d => d.status === 'PENDING')
      .sort((a, b) => new Date(a.expectedDate).getTime() - new Date(b.expectedDate).getTime());
  }

  async getDisputed(merchantId: string): Promise<ExpectedDeposit[]> {
    const list = await this.list(merchantId);
    return list.filter(d => d.status === 'DISPUTED');
  }

  async getOverdue(merchantId: string): Promise<ExpectedDeposit[]> {
    const list = await this.list(merchantId);
    const now = Date.now();
    return list.filter(d => d.status === 'PENDING' && new Date(d.expectedDate).getTime() < now);
  }

  async getReconciliationRate(merchantId: string, sinceDays = 30): Promise<{
    total: number;
    matched: number;
    disputed: number;
    unmatched: number;
    rate: number;
  }> {
    const list = await this.list(merchantId);
    const cutoff = Date.now() - sinceDays * 86400000;
    const filtered = list.filter(d => new Date(d.createdAt).getTime() > cutoff && d.status !== 'PENDING');
    const matched = filtered.filter(d => d.status === 'MATCHED').length;
    const disputed = filtered.filter(d => d.status === 'DISPUTED').length;
    const unmatched = filtered.filter(d => d.status === 'UNMATCHED').length;
    return {
      total: filtered.length,
      matched,
      disputed,
      unmatched,
      rate: filtered.length > 0 ? Math.round((matched / filtered.length) * 100) : 0,
    };
  }
}

export const merchantDepositReconciliation = new MerchantDepositReconciliationService();
