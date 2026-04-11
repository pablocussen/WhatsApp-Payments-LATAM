import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('aml-rules');

const AML_PREFIX = 'aml:';
const AML_TTL = 365 * 24 * 60 * 60;

export type AMLAlertLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AMLAlertStatus = 'PENDING' | 'REVIEWED' | 'ESCALATED' | 'DISMISSED';

export interface AMLAlert {
  id: string;
  userId: string;
  ruleTriggered: string;
  level: AMLAlertLevel;
  status: AMLAlertStatus;
  amount: number;
  description: string;
  transactionRef: string | null;
  reviewedBy: string | null;
  reviewNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

// UAF threshold: UF 450 ≈ $17,010,000 CLP
const UAF_THRESHOLD = 17_010_000;
const STRUCTURING_THRESHOLD = 15_000_000;
const VELOCITY_TX_LIMIT = 20; // max tx per hour
const ROUND_AMOUNT_THRESHOLD = 5_000_000;

export class AMLRulesService {
  /**
   * Evaluate a transaction against AML rules.
   */
  evaluateTransaction(amount: number, userId: string, context: {
    txCountLastHour: number;
    txCountToday: number;
    dailyVolume: number;
    isNewRecipient: boolean;
    accountAgeDays: number;
  }): AMLAlert[] {
    const alerts: AMLAlert[] = [];
    const now = new Date().toISOString();

    // Rule 1: UAF mandatory reporting (> UF 450)
    if (amount >= UAF_THRESHOLD) {
      alerts.push(this.createAlert(userId, 'UAF_THRESHOLD', 'CRITICAL', amount,
        `Transacción supera umbral UAF (UF 450): ${formatCLP(amount)}`, now));
    }

    // Rule 2: Structuring detection (multiple tx just below threshold)
    if (amount >= STRUCTURING_THRESHOLD && amount < UAF_THRESHOLD && context.txCountToday >= 3) {
      alerts.push(this.createAlert(userId, 'STRUCTURING', 'HIGH', amount,
        `Posible structuring: ${formatCLP(amount)} con ${context.txCountToday} tx hoy`, now));
    }

    // Rule 3: Velocity — too many tx per hour
    if (context.txCountLastHour >= VELOCITY_TX_LIMIT) {
      alerts.push(this.createAlert(userId, 'VELOCITY', 'MEDIUM', amount,
        `${context.txCountLastHour} transacciones en la última hora`, now));
    }

    // Rule 4: Round amounts (potential money laundering indicator)
    if (amount >= ROUND_AMOUNT_THRESHOLD && amount % 1_000_000 === 0) {
      alerts.push(this.createAlert(userId, 'ROUND_AMOUNT', 'LOW', amount,
        `Monto redondo sospechoso: ${formatCLP(amount)}`, now));
    }

    // Rule 5: New account + high value
    if (context.accountAgeDays < 7 && amount >= 1_000_000) {
      alerts.push(this.createAlert(userId, 'NEW_ACCOUNT_HIGH_VALUE', 'HIGH', amount,
        `Cuenta nueva (${context.accountAgeDays} días) con tx de ${formatCLP(amount)}`, now));
    }

    // Rule 6: Daily volume spike
    if (context.dailyVolume + amount > UAF_THRESHOLD * 0.8) {
      alerts.push(this.createAlert(userId, 'DAILY_VOLUME_SPIKE', 'MEDIUM', amount,
        `Volumen diario acercándose al umbral UAF: ${formatCLP(context.dailyVolume + amount)}`, now));
    }

    return alerts;
  }

  /**
   * Save an alert.
   */
  async saveAlert(alert: AMLAlert): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${AML_PREFIX}${alert.id}`, JSON.stringify(alert), { EX: AML_TTL });
      await redis.lPush(`${AML_PREFIX}list:${alert.userId}`, alert.id);
    } catch (err) {
      log.warn('Failed to save AML alert', { alertId: alert.id, error: (err as Error).message });
    }
    log.info('AML alert created', { alertId: alert.id, rule: alert.ruleTriggered, level: alert.level });
  }

  /**
   * Review an alert.
   */
  async reviewAlert(alertId: string, reviewedBy: string, note: string, dismiss: boolean): Promise<AMLAlert | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${AML_PREFIX}${alertId}`);
      if (!raw) return null;

      const alert = JSON.parse(raw) as AMLAlert;
      alert.status = dismiss ? 'DISMISSED' : 'ESCALATED';
      alert.reviewedBy = reviewedBy;
      alert.reviewNote = note;
      alert.reviewedAt = new Date().toISOString();

      await redis.set(`${AML_PREFIX}${alertId}`, JSON.stringify(alert), { EX: AML_TTL });
      return alert;
    } catch {
      return null;
    }
  }

  /**
   * Get alert.
   */
  async getAlert(alertId: string): Promise<AMLAlert | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${AML_PREFIX}${alertId}`);
      return raw ? JSON.parse(raw) as AMLAlert : null;
    } catch {
      return null;
    }
  }

  /**
   * Check if amount requires UAF reporting.
   */
  requiresUAFReport(amount: number): boolean {
    return amount >= UAF_THRESHOLD;
  }

  getAlertSummary(alert: AMLAlert): string {
    return `[${alert.level}] ${alert.ruleTriggered} — ${formatCLP(alert.amount)} — ${alert.status}`;
  }

  private createAlert(userId: string, rule: string, level: AMLAlertLevel, amount: number, description: string, now: string): AMLAlert {
    return {
      id: `aml_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`,
      userId,
      ruleTriggered: rule,
      level,
      status: 'PENDING',
      amount,
      description,
      transactionRef: null,
      reviewedBy: null,
      reviewNote: null,
      createdAt: now,
      reviewedAt: null,
    };
  }
}

export const amlRules = new AMLRulesService();
