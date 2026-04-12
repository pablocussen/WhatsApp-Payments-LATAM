import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('financial-health');
const FH_PREFIX = 'finhealth:';
const FH_TTL = 30 * 24 * 60 * 60;

export type HealthRating = 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'CRITICAL';

export interface FinancialHealthScore {
  userId: string;
  score: number;
  rating: HealthRating;
  factors: {
    savingsRatio: number;
    expenseDiscipline: number;
    incomeStability: number;
    debtManagement: number;
    emergencyFund: number;
  };
  recommendations: string[];
  calculatedAt: string;
}

export class UserFinancialHealthService {
  calculateScore(input: {
    monthlyIncome: number;
    monthlySavings: number;
    monthlyExpenses: number;
    incomeVariability: number;
    emergencyFund: number;
    hasDebt: boolean;
  }): FinancialHealthScore {
    const savingsRatio = input.monthlyIncome > 0 ? Math.min(25, (input.monthlySavings / input.monthlyIncome) * 100) : 0;
    const expenseDiscipline = input.monthlyIncome > 0 ? Math.max(0, 25 - ((input.monthlyExpenses / input.monthlyIncome) * 25)) : 0;
    const incomeStability = Math.max(0, 20 - input.incomeVariability);
    const debtManagement = input.hasDebt ? 10 : 20;
    const emergencyMonths = input.monthlyExpenses > 0 ? input.emergencyFund / input.monthlyExpenses : 0;
    const emergencyScore = Math.min(10, emergencyMonths * 1.67);

    const score = Math.round(savingsRatio + expenseDiscipline + incomeStability + debtManagement + emergencyScore);
    const rating = this.getRating(score);
    const recommendations = this.getRecommendations(input, score);

    return {
      userId: '',
      score,
      rating,
      factors: {
        savingsRatio: Math.round(savingsRatio),
        expenseDiscipline: Math.round(expenseDiscipline),
        incomeStability: Math.round(incomeStability),
        debtManagement,
        emergencyFund: Math.round(emergencyScore),
      },
      recommendations,
      calculatedAt: new Date().toISOString(),
    };
  }

  getRating(score: number): HealthRating {
    if (score >= 85) return 'EXCELLENT';
    if (score >= 70) return 'GOOD';
    if (score >= 50) return 'FAIR';
    if (score >= 30) return 'POOR';
    return 'CRITICAL';
  }

  getRecommendations(input: { monthlyIncome: number; monthlySavings: number; monthlyExpenses: number; emergencyFund: number; hasDebt: boolean }, score: number): string[] {
    const recs: string[] = [];
    const savingsRate = input.monthlyIncome > 0 ? (input.monthlySavings / input.monthlyIncome) * 100 : 0;
    const emergencyMonths = input.monthlyExpenses > 0 ? input.emergencyFund / input.monthlyExpenses : 0;

    if (savingsRate < 10) recs.push('Aumenta tu tasa de ahorro al menos al 10% del ingreso.');
    if (emergencyMonths < 3) recs.push('Construye un fondo de emergencia de 3+ meses de gastos.');
    if (input.hasDebt) recs.push('Prioriza pagar deudas con tasas altas.');
    if (input.monthlyExpenses > input.monthlyIncome * 0.8) recs.push('Tus gastos son muy altos, revisa categorias no esenciales.');
    if (score >= 85) recs.push('Tu salud financiera es excelente. Considera inversiones.');

    return recs;
  }

  async saveScore(userId: string, score: FinancialHealthScore): Promise<void> {
    try { const redis = getRedis(); await redis.set(FH_PREFIX + userId, JSON.stringify({ ...score, userId }), { EX: FH_TTL }); }
    catch (err) { log.warn('Failed to save score', { error: (err as Error).message }); }
  }

  async getScore(userId: string): Promise<FinancialHealthScore | null> {
    try { const redis = getRedis(); const raw = await redis.get(FH_PREFIX + userId); return raw ? JSON.parse(raw) as FinancialHealthScore : null; }
    catch { return null; }
  }
}

export const userFinancialHealth = new UserFinancialHealthService();
