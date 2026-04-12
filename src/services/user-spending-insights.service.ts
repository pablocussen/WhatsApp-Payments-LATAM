import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('spending-insights');
const SI_PREFIX = 'spinsights:';
const SI_TTL = 90 * 24 * 60 * 60;

export interface SpendingInsight {
  userId: string;
  period: string;
  totalSpent: number;
  avgDaily: number;
  topCategory: string;
  topCategoryAmount: number;
  compareLastMonth: number;
  biggestTransaction: number;
  mostFrequentRecipient: string | null;
  transactionCount: number;
  generatedAt: string;
}

export class UserSpendingInsightsService {
  async generateInsights(userId: string, data: {
    transactions: { amount: number; category: string; recipient: string }[];
    lastMonthTotal: number;
  }): Promise<SpendingInsight> {
    const totalSpent = data.transactions.reduce((s, t) => s + t.amount, 0);

    const categoryMap = new Map<string, number>();
    const recipientMap = new Map<string, number>();

    for (const tx of data.transactions) {
      categoryMap.set(tx.category, (categoryMap.get(tx.category) ?? 0) + tx.amount);
      recipientMap.set(tx.recipient, (recipientMap.get(tx.recipient) ?? 0) + 1);
    }

    const topCategory = Array.from(categoryMap.entries()).sort((a, b) => b[1] - a[1])[0] ?? ['OTHER', 0];
    const topRecipient = Array.from(recipientMap.entries()).sort((a, b) => b[1] - a[1])[0];

    const compareLastMonth = data.lastMonthTotal > 0
      ? Math.round(((totalSpent - data.lastMonthTotal) / data.lastMonthTotal) * 100)
      : 0;

    const insight: SpendingInsight = {
      userId,
      period: new Date().toISOString().slice(0, 7),
      totalSpent,
      avgDaily: Math.round(totalSpent / 30),
      topCategory: topCategory[0],
      topCategoryAmount: topCategory[1],
      compareLastMonth,
      biggestTransaction: data.transactions.length > 0 ? Math.max(...data.transactions.map(t => t.amount)) : 0,
      mostFrequentRecipient: topRecipient ? topRecipient[0] : null,
      transactionCount: data.transactions.length,
      generatedAt: new Date().toISOString(),
    };

    try {
      const redis = getRedis();
      await redis.set(`${SI_PREFIX}${userId}:${insight.period}`, JSON.stringify(insight), { EX: SI_TTL });
    } catch (err) { log.warn('Failed to save insights', { error: (err as Error).message }); }

    return insight;
  }

  async getInsights(userId: string, period?: string): Promise<SpendingInsight | null> {
    const p = period ?? new Date().toISOString().slice(0, 7);
    try {
      const redis = getRedis();
      const raw = await redis.get(`${SI_PREFIX}${userId}:${p}`);
      return raw ? JSON.parse(raw) as SpendingInsight : null;
    } catch { return null; }
  }

  formatInsight(i: SpendingInsight): string {
    const arrow = i.compareLastMonth > 0 ? 'mas' : i.compareLastMonth < 0 ? 'menos' : 'igual';
    return [
      `Gastaste ${formatCLP(i.totalSpent)} este mes`,
      `${Math.abs(i.compareLastMonth)}% ${arrow} que el mes pasado`,
      `Categoria top: ${i.topCategory} (${formatCLP(i.topCategoryAmount)})`,
      `Promedio diario: ${formatCLP(i.avgDaily)}`,
      `Transaccion mas grande: ${formatCLP(i.biggestTransaction)}`,
    ].join('\n');
  }
}

export const userSpendingInsights = new UserSpendingInsightsService();
