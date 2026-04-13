import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('user-financial-wellness');
const PREFIX = 'user:wellness:';
const TTL = 365 * 24 * 60 * 60;

export type WellnessGrade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface WellnessSnapshot {
  userId: string;
  monthlyIncome: number;
  monthlyExpenses: number;
  savingsBalance: number;
  debtBalance: number;
  emergencyFundMonths: number;
  savingsRate: number;
  debtToIncomeRatio: number;
  wellnessScore: number;
  grade: WellnessGrade;
  updatedAt: string;
  recommendations: string[];
}

export class UserFinancialWellnessService {
  private key(userId: string): string {
    return `${PREFIX}${userId}`;
  }

  async get(userId: string): Promise<WellnessSnapshot | null> {
    const raw = await getRedis().get(this.key(userId));
    return raw ? JSON.parse(raw) : null;
  }

  private computeScore(snapshot: {
    monthlyIncome: number;
    monthlyExpenses: number;
    savingsBalance: number;
    debtBalance: number;
  }): { score: number; savingsRate: number; debtToIncomeRatio: number; emergencyFundMonths: number } {
    const savings = snapshot.monthlyIncome - snapshot.monthlyExpenses;
    const savingsRate = snapshot.monthlyIncome > 0
      ? Math.max(0, (savings / snapshot.monthlyIncome) * 100)
      : 0;
    const debtToIncomeRatio = snapshot.monthlyIncome > 0
      ? (snapshot.debtBalance / (snapshot.monthlyIncome * 12)) * 100
      : 0;
    const emergencyFundMonths = snapshot.monthlyExpenses > 0
      ? snapshot.savingsBalance / snapshot.monthlyExpenses
      : 0;
    let score = 0;
    score += Math.min(30, savingsRate);
    score += Math.min(30, emergencyFundMonths * 5);
    score += Math.max(0, 30 - debtToIncomeRatio);
    score += snapshot.savingsBalance > 0 ? 10 : 0;
    return {
      score: Math.round(Math.min(100, Math.max(0, score))),
      savingsRate: Math.round(savingsRate * 10) / 10,
      debtToIncomeRatio: Math.round(debtToIncomeRatio * 10) / 10,
      emergencyFundMonths: Math.round(emergencyFundMonths * 10) / 10,
    };
  }

  private gradeFor(score: number): WellnessGrade {
    if (score >= 85) return 'A';
    if (score >= 70) return 'B';
    if (score >= 55) return 'C';
    if (score >= 40) return 'D';
    return 'F';
  }

  private recommendations(snapshot: {
    savingsRate: number;
    emergencyFundMonths: number;
    debtToIncomeRatio: number;
  }): string[] {
    const out: string[] = [];
    if (snapshot.emergencyFundMonths < 3) {
      out.push('Construye un fondo de emergencia de al menos 3 meses de gastos');
    }
    if (snapshot.savingsRate < 10) {
      out.push('Intenta ahorrar al menos 10% de tus ingresos mensuales');
    }
    if (snapshot.debtToIncomeRatio > 30) {
      out.push('Tu ratio de deuda/ingreso es alto. Prioriza pagar deudas');
    }
    if (snapshot.savingsRate >= 20 && snapshot.emergencyFundMonths >= 6) {
      out.push('Excelente! Considera invertir el excedente en instrumentos diversificados');
    }
    if (out.length === 0) out.push('Mantienes una buena salud financiera. Sigue asi!');
    return out;
  }

  async update(input: {
    userId: string;
    monthlyIncome: number;
    monthlyExpenses: number;
    savingsBalance: number;
    debtBalance: number;
  }): Promise<WellnessSnapshot> {
    if (input.monthlyIncome < 0 || input.monthlyExpenses < 0 || input.savingsBalance < 0 || input.debtBalance < 0) {
      throw new Error('Valores no pueden ser negativos');
    }
    const computed = this.computeScore(input);
    const grade = this.gradeFor(computed.score);
    const snapshot: WellnessSnapshot = {
      userId: input.userId,
      monthlyIncome: input.monthlyIncome,
      monthlyExpenses: input.monthlyExpenses,
      savingsBalance: input.savingsBalance,
      debtBalance: input.debtBalance,
      emergencyFundMonths: computed.emergencyFundMonths,
      savingsRate: computed.savingsRate,
      debtToIncomeRatio: computed.debtToIncomeRatio,
      wellnessScore: computed.score,
      grade,
      updatedAt: new Date().toISOString(),
      recommendations: this.recommendations(computed),
    };
    await getRedis().set(this.key(input.userId), JSON.stringify(snapshot), { EX: TTL });
    log.info('wellness updated', { userId: input.userId, score: snapshot.wellnessScore, grade });
    return snapshot;
  }

  formatReport(snapshot: WellnessSnapshot): string {
    return [
      `Score: ${snapshot.wellnessScore}/100 (Grade ${snapshot.grade})`,
      `Ingreso: $${snapshot.monthlyIncome.toLocaleString('es-CL')}`,
      `Gastos: $${snapshot.monthlyExpenses.toLocaleString('es-CL')}`,
      `Tasa de ahorro: ${snapshot.savingsRate}%`,
      `Fondo emergencia: ${snapshot.emergencyFundMonths} meses`,
      `Deuda/Ingreso: ${snapshot.debtToIncomeRatio}%`,
      '',
      'Recomendaciones:',
      ...snapshot.recommendations.map(r => `  - ${r}`),
    ].join('\n');
  }
}

export const userFinancialWellness = new UserFinancialWellnessService();
