import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-shared-expense');
const PREFIX = 'user:shared-expense:';
const TTL = 365 * 24 * 60 * 60;

export type SettlementStatus = 'UNSETTLED' | 'SETTLED';

export interface ExpenseParticipant {
  userId: string;
  name: string;
  share: number;
  paid: number;
}

export interface SharedExpense {
  id: string;
  groupId: string;
  ownerId: string;
  description: string;
  totalAmount: number;
  paidBy: string;
  participants: ExpenseParticipant[];
  status: SettlementStatus;
  createdAt: string;
  settledAt?: string;
}

export class UserSharedExpenseService {
  private key(groupId: string): string {
    return `${PREFIX}${groupId}`;
  }

  async list(groupId: string): Promise<SharedExpense[]> {
    const raw = await getRedis().get(this.key(groupId));
    return raw ? JSON.parse(raw) : [];
  }

  async create(input: {
    groupId: string;
    ownerId: string;
    description: string;
    totalAmount: number;
    paidBy: string;
    participants: { userId: string; name: string; share?: number }[];
    splitEqual?: boolean;
  }): Promise<SharedExpense> {
    if (input.totalAmount <= 0) throw new Error('Monto debe ser positivo');
    if (input.description.length > 100) throw new Error('Descripcion excede 100 caracteres');
    if (input.participants.length < 2) throw new Error('Minimo 2 participantes');
    if (input.participants.length > 20) throw new Error('Maximo 20 participantes');
    if (!input.participants.some(p => p.userId === input.paidBy)) {
      throw new Error('El que pago debe estar entre los participantes');
    }
    let participants: ExpenseParticipant[];
    if (input.splitEqual) {
      const equalShare = Math.floor(input.totalAmount / input.participants.length);
      participants = input.participants.map(p => ({
        userId: p.userId,
        name: p.name,
        share: equalShare,
        paid: p.userId === input.paidBy ? input.totalAmount : 0,
      }));
    } else {
      const totalShares = input.participants.reduce((s, p) => s + (p.share ?? 0), 0);
      if (Math.abs(totalShares - input.totalAmount) > 1) {
        throw new Error('Shares deben sumar el total');
      }
      participants = input.participants.map(p => ({
        userId: p.userId,
        name: p.name,
        share: p.share ?? 0,
        paid: p.userId === input.paidBy ? input.totalAmount : 0,
      }));
    }
    const list = await this.list(input.groupId);
    if (list.filter(e => e.status === 'UNSETTLED').length >= 100) {
      throw new Error('Maximo 100 gastos sin liquidar');
    }
    const expense: SharedExpense = {
      id: `shexp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      groupId: input.groupId,
      ownerId: input.ownerId,
      description: input.description,
      totalAmount: input.totalAmount,
      paidBy: input.paidBy,
      participants,
      status: 'UNSETTLED',
      createdAt: new Date().toISOString(),
    };
    list.push(expense);
    await getRedis().set(this.key(input.groupId), JSON.stringify(list), { EX: TTL });
    log.info('shared expense created', { id: expense.id });
    return expense;
  }

  async settle(groupId: string, id: string): Promise<SharedExpense | null> {
    const list = await this.list(groupId);
    const expense = list.find(e => e.id === id);
    if (!expense || expense.status === 'SETTLED') return null;
    expense.status = 'SETTLED';
    expense.settledAt = new Date().toISOString();
    for (const p of expense.participants) {
      p.paid = p.share;
    }
    await getRedis().set(this.key(groupId), JSON.stringify(list), { EX: TTL });
    return expense;
  }

  async computeBalances(groupId: string): Promise<Record<string, number>> {
    const list = await this.list(groupId);
    const balances: Record<string, number> = {};
    for (const expense of list.filter(e => e.status === 'UNSETTLED')) {
      for (const p of expense.participants) {
        balances[p.userId] = (balances[p.userId] ?? 0) + (p.paid - p.share);
      }
    }
    return balances;
  }

  async getOptimalTransfers(groupId: string): Promise<{ from: string; to: string; amount: number }[]> {
    const balances = await this.computeBalances(groupId);
    const creditors: { userId: string; amount: number }[] = [];
    const debtors: { userId: string; amount: number }[] = [];
    for (const [userId, balance] of Object.entries(balances)) {
      if (balance > 0) creditors.push({ userId, amount: balance });
      else if (balance < 0) debtors.push({ userId, amount: -balance });
    }
    creditors.sort((a, b) => b.amount - a.amount);
    debtors.sort((a, b) => b.amount - a.amount);
    const transfers: { from: string; to: string; amount: number }[] = [];
    let i = 0;
    let j = 0;
    while (i < debtors.length && j < creditors.length) {
      const amount = Math.min(debtors[i].amount, creditors[j].amount);
      transfers.push({ from: debtors[i].userId, to: creditors[j].userId, amount });
      debtors[i].amount -= amount;
      creditors[j].amount -= amount;
      if (debtors[i].amount === 0) i++;
      if (creditors[j].amount === 0) j++;
    }
    return transfers;
  }

  async getUnsettledCount(groupId: string): Promise<number> {
    const list = await this.list(groupId);
    return list.filter(e => e.status === 'UNSETTLED').length;
  }
}

export const userSharedExpense = new UserSharedExpenseService();
