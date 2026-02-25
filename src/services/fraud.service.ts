import { prisma } from '../config/database';
import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('fraud-service');

// ─── Types ──────────────────────────────────────────────

export interface FraudCheckInput {
  senderId: string;
  receiverId: string;
  amount: number;
  senderPhone: string;
  ip?: string;
  deviceFingerprint?: string;
}

export interface FraudCheckResult {
  score: number;            // 0.0 (safe) → 1.0 (fraud)
  action: 'approve' | 'review' | 'block';
  reasons: string[];
  processingTimeMs: number;
}

// ─── Fraud Detection Service ────────────────────────────

export class FraudService {
  private readonly VELOCITY_WINDOW = 300;  // 5 minutes in seconds
  private readonly MAX_TX_PER_WINDOW = 10;
  private readonly DAILY_TX_LIMIT = 50;

  async checkTransaction(input: FraudCheckInput): Promise<FraudCheckResult> {
    const start = Date.now();
    const reasons: string[] = [];
    let score = 0;

    // ─── Rule 1: Velocity check (transactions per window)
    const velocityScore = await this.checkVelocity(input.senderId);
    if (velocityScore > 0) {
      score += velocityScore;
      reasons.push(`Alta frecuencia de transacciones (${velocityScore > 0.3 ? 'crítica' : 'elevada'})`);
    }

    // ─── Rule 2: Amount anomaly
    const amountScore = await this.checkAmountAnomaly(input.senderId, input.amount);
    if (amountScore > 0) {
      score += amountScore;
      reasons.push('Monto inusual para este usuario');
    }

    // ─── Rule 3: New receiver
    const newReceiverScore = await this.checkNewReceiver(input.senderId, input.receiverId);
    if (newReceiverScore > 0) {
      score += newReceiverScore;
      reasons.push('Primer pago a este destinatario');
    }

    // ─── Rule 4: Time-based (late night transactions)
    const hour = new Date().getHours();
    if (hour >= 1 && hour <= 5) {
      score += 0.15;
      reasons.push('Transacción en horario inusual (madrugada)');
    }

    // ─── Rule 5: Daily transaction count
    const dailyScore = await this.checkDailyLimit(input.senderId);
    if (dailyScore > 0) {
      score += dailyScore;
      reasons.push('Muchas transacciones hoy');
    }

    // Clamp score 0-1
    score = Math.min(1, Math.max(0, score));

    // Determine action
    let action: FraudCheckResult['action'];
    if (score >= 0.7) {
      action = 'block';
      log.warn('Transaction blocked by fraud detection', { ...input, score, reasons });
    } else if (score >= 0.3) {
      action = 'review';
      log.info('Transaction flagged for review', { senderId: input.senderId, score });
    } else {
      action = 'approve';
    }

    // Record velocity
    await this.recordTransaction(input.senderId);

    return {
      score: Math.round(score * 100) / 100,
      action,
      reasons,
      processingTimeMs: Date.now() - start,
    };
  }

  private async checkVelocity(userId: string): Promise<number> {
    try {
      const redis = getRedis();
      const key = `fraud:velocity:${userId}`;
      const count = await redis.get(key);
      const txCount = parseInt(count || '0', 10);

      if (txCount >= this.MAX_TX_PER_WINDOW) return 0.5;
      if (txCount >= this.MAX_TX_PER_WINDOW / 2) return 0.2;
      return 0;
    } catch {
      return 0; // Fail open for velocity check
    }
  }

  private async recordTransaction(userId: string): Promise<void> {
    try {
      const redis = getRedis();
      const key = `fraud:velocity:${userId}`;
      await redis.multi()
        .incr(key)
        .expire(key, this.VELOCITY_WINDOW)
        .exec();
    } catch {
      // Non-critical, log and continue
    }
  }

  private async checkAmountAnomaly(userId: string, amount: number): Promise<number> {
    const stats = await prisma.transaction.aggregate({
      where: {
        senderId: userId,
        status: 'COMPLETED',
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // last 30 days
      },
      _avg: { amount: true },
      _max: { amount: true },
      _count: true,
    });

    // New user with no history — slight flag for large amounts
    if (stats._count < 3) {
      return amount > 100_000 ? 0.15 : 0;
    }

    const avgAmount = Number(stats._avg.amount ?? 0);
    const maxAmount = Number(stats._max.amount ?? 0);

    // More than 3x the average or 2x the max
    if (amount > avgAmount * 3) return 0.3;
    if (amount > maxAmount * 2) return 0.25;
    if (amount > avgAmount * 2) return 0.1;

    return 0;
  }

  private async checkNewReceiver(senderId: string, receiverId: string): Promise<number> {
    const previousTx = await prisma.transaction.findFirst({
      where: {
        senderId,
        receiverId,
        status: 'COMPLETED',
      },
    });

    // First time sending to this person — minor flag
    return previousTx ? 0 : 0.1;
  }

  private async checkDailyLimit(userId: string): Promise<number> {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const count = await prisma.transaction.count({
      where: {
        senderId: userId,
        createdAt: { gte: startOfDay },
      },
    });

    if (count >= this.DAILY_TX_LIMIT) return 0.4;
    if (count >= this.DAILY_TX_LIMIT / 2) return 0.1;
    return 0;
  }
}
