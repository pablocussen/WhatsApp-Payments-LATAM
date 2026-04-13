import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-monthly-statement');
const PREFIX = 'user:statement:';
const TTL = 365 * 24 * 60 * 60;

export type StatementStatus = 'GENERATING' | 'READY' | 'FAILED';

export interface StatementLineItem {
  date: string;
  description: string;
  category: string;
  amount: number;
  type: 'DEBIT' | 'CREDIT';
}

export interface MonthlyStatement {
  id: string;
  userId: string;
  year: number;
  month: number;
  openingBalance: number;
  closingBalance: number;
  totalCredits: number;
  totalDebits: number;
  transactionCount: number;
  lineItems: StatementLineItem[];
  downloadUrl?: string;
  status: StatementStatus;
  generatedAt: string;
}

export class UserMonthlyStatementService {
  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  async list(userId: string): Promise<MonthlyStatement[]> {
    const raw = await getRedis().get(this.key(userId));
    return raw ? JSON.parse(raw) : [];
  }

  async generate(input: {
    userId: string;
    year: number;
    month: number;
    openingBalance: number;
    lineItems: StatementLineItem[];
  }): Promise<MonthlyStatement> {
    if (input.month < 0 || input.month > 11) throw new Error('Mes debe ser entre 0 y 11');
    if (input.year < 2020 || input.year > 2100) throw new Error('Ano fuera de rango');
    if (input.openingBalance < 0) throw new Error('Saldo inicial no puede ser negativo');
    const list = await this.list(input.userId);
    if (list.some(s => s.year === input.year && s.month === input.month)) {
      throw new Error('Ya existe estado para ese periodo');
    }
    const totalCredits = input.lineItems.filter(i => i.type === 'CREDIT').reduce((s, i) => s + i.amount, 0);
    const totalDebits = input.lineItems.filter(i => i.type === 'DEBIT').reduce((s, i) => s + i.amount, 0);
    const closingBalance = input.openingBalance + totalCredits - totalDebits;
    const statement: MonthlyStatement = {
      id: `stmt_${input.year}_${input.month}_${Math.random().toString(36).slice(2, 8)}`,
      userId: input.userId,
      year: input.year,
      month: input.month,
      openingBalance: input.openingBalance,
      closingBalance,
      totalCredits,
      totalDebits,
      transactionCount: input.lineItems.length,
      lineItems: input.lineItems,
      status: 'READY',
      generatedAt: new Date().toISOString(),
    };
    list.push(statement);
    if (list.length > 24) list.splice(0, list.length - 24);
    await getRedis().set(this.key(input.userId), JSON.stringify(list), { EX: TTL });
    log.info('statement generated', { userId: input.userId, period: `${input.year}-${input.month + 1}` });
    return statement;
  }

  async get(userId: string, year: number, month: number): Promise<MonthlyStatement | null> {
    const list = await this.list(userId);
    return list.find(s => s.year === year && s.month === month) ?? null;
  }

  async setDownloadUrl(userId: string, id: string, url: string): Promise<MonthlyStatement | null> {
    if (!/^https?:\/\//.test(url)) throw new Error('URL invalida');
    const list = await this.list(userId);
    const stmt = list.find(s => s.id === id);
    if (!stmt) return null;
    stmt.downloadUrl = url;
    await getRedis().set(this.key(userId), JSON.stringify(list), { EX: TTL });
    return stmt;
  }

  async getByCategory(userId: string, year: number, month: number): Promise<Record<string, { credits: number; debits: number }>> {
    const stmt = await this.get(userId, year, month);
    if (!stmt) return {};
    const totals: Record<string, { credits: number; debits: number }> = {};
    for (const item of stmt.lineItems) {
      if (!totals[item.category]) totals[item.category] = { credits: 0, debits: 0 };
      if (item.type === 'CREDIT') totals[item.category].credits += item.amount;
      else totals[item.category].debits += item.amount;
    }
    return totals;
  }

  async getYearSummary(userId: string, year: number): Promise<{ totalCredits: number; totalDebits: number; net: number; months: number }> {
    const list = await this.list(userId);
    const yearStatements = list.filter(s => s.year === year);
    const totalCredits = yearStatements.reduce((s, x) => s + x.totalCredits, 0);
    const totalDebits = yearStatements.reduce((s, x) => s + x.totalDebits, 0);
    return {
      totalCredits,
      totalDebits,
      net: totalCredits - totalDebits,
      months: yearStatements.length,
    };
  }
}

export const userMonthlyStatement = new UserMonthlyStatementService();
