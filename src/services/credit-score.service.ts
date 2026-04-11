import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('credit-score');

const SCORE_PREFIX = 'cscore:';
const SCORE_TTL = 30 * 24 * 60 * 60; // 30 days

export type ScoreRating = 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR' | 'INSUFFICIENT';

export interface CreditScoreFactors {
  transactionHistory: number; // 0-25 points
  paymentConsistency: number; // 0-25 points
  accountAge: number; // 0-20 points
  kycLevel: number; // 0-15 points
  disputeHistory: number; // 0-15 points (lower disputes = higher score)
}

export interface CreditScore {
  userId: string;
  score: number; // 0-100
  rating: ScoreRating;
  factors: CreditScoreFactors;
  maxLoanAmount: number; // CLP
  calculatedAt: string;
}

export class CreditScoreService {
  /**
   * Calculate credit score for a user based on their activity.
   */
  async calculateScore(userId: string, data: {
    totalTransactions: number;
    monthsActive: number;
    onTimePayments: number;
    totalPayments: number;
    kycLevel: 'BASIC' | 'INTERMEDIATE' | 'FULL';
    openDisputes: number;
    resolvedDisputes: number;
    avgMonthlyVolume: number;
  }): Promise<CreditScore> {
    const factors: CreditScoreFactors = {
      transactionHistory: this.scoreTxHistory(data.totalTransactions),
      paymentConsistency: this.scoreConsistency(data.onTimePayments, data.totalPayments),
      accountAge: this.scoreAccountAge(data.monthsActive),
      kycLevel: this.scoreKyc(data.kycLevel),
      disputeHistory: this.scoreDisputes(data.openDisputes, data.resolvedDisputes),
    };

    const score = Math.min(100, Object.values(factors).reduce((sum, v) => sum + v, 0));
    const rating = this.getRating(score);
    const maxLoan = this.calculateMaxLoan(score, data.avgMonthlyVolume);

    const creditScore: CreditScore = {
      userId,
      score,
      rating,
      factors,
      maxLoanAmount: maxLoan,
      calculatedAt: new Date().toISOString(),
    };

    try {
      const redis = getRedis();
      await redis.set(`${SCORE_PREFIX}${userId}`, JSON.stringify(creditScore), { EX: SCORE_TTL });
    } catch (err) {
      log.warn('Failed to cache score', { userId, error: (err as Error).message });
    }

    log.info('Credit score calculated', { userId, score, rating });
    return creditScore;
  }

  /**
   * Get cached credit score.
   */
  async getScore(userId: string): Promise<CreditScore | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${SCORE_PREFIX}${userId}`);
      return raw ? JSON.parse(raw) as CreditScore : null;
    } catch {
      return null;
    }
  }

  getRating(score: number): ScoreRating {
    if (score >= 80) return 'EXCELLENT';
    if (score >= 60) return 'GOOD';
    if (score >= 40) return 'FAIR';
    if (score >= 20) return 'POOR';
    return 'INSUFFICIENT';
  }

  getRatingLabel(rating: ScoreRating): string {
    const labels: Record<ScoreRating, string> = {
      EXCELLENT: 'Excelente',
      GOOD: 'Bueno',
      FAIR: 'Regular',
      POOR: 'Bajo',
      INSUFFICIENT: 'Insuficiente',
    };
    return labels[rating];
  }

  private scoreTxHistory(total: number): number {
    if (total >= 200) return 25;
    if (total >= 100) return 20;
    if (total >= 50) return 15;
    if (total >= 20) return 10;
    if (total >= 5) return 5;
    return 0;
  }

  private scoreConsistency(onTime: number, total: number): number {
    if (total === 0) return 0;
    const pct = onTime / total;
    if (pct >= 0.95) return 25;
    if (pct >= 0.85) return 20;
    if (pct >= 0.70) return 15;
    if (pct >= 0.50) return 10;
    return 5;
  }

  private scoreAccountAge(months: number): number {
    if (months >= 24) return 20;
    if (months >= 12) return 15;
    if (months >= 6) return 10;
    if (months >= 3) return 5;
    return 0;
  }

  private scoreKyc(level: string): number {
    if (level === 'FULL') return 15;
    if (level === 'INTERMEDIATE') return 10;
    return 5;
  }

  private scoreDisputes(open: number, resolved: number): number {
    const total = open + resolved;
    if (total === 0) return 15;
    if (open > 0) return 5;
    if (total <= 2) return 12;
    return 8;
  }

  private calculateMaxLoan(score: number, avgMonthlyVolume: number): number {
    if (score < 40) return 0;
    const multiplier = score >= 80 ? 3 : score >= 60 ? 2 : 1;
    return Math.round(avgMonthlyVolume * multiplier);
  }
}

export const creditScore = new CreditScoreService();
