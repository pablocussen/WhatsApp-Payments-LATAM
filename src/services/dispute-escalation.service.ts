import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('dispute-escalation');

const ESC_PREFIX = 'dspesc:';
const ESC_TTL = 180 * 24 * 60 * 60;

export type EscalationLevel = 'L1_AUTO' | 'L2_SUPPORT' | 'L3_COMPLIANCE' | 'L4_LEGAL';
export type EscalationStatus = 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';

export interface DisputeEscalation {
  id: string;
  disputeId: string;
  userId: string;
  merchantId: string;
  amount: number;
  reason: string;
  level: EscalationLevel;
  status: EscalationStatus;
  slaDeadline: string;
  assignedTo: string | null;
  resolution: string | null;
  history: { level: EscalationLevel; timestamp: string; note: string }[];
  createdAt: string;
  resolvedAt: string | null;
}

// SLA in hours per level
const SLA_HOURS: Record<EscalationLevel, number> = {
  L1_AUTO: 2,
  L2_SUPPORT: 24,
  L3_COMPLIANCE: 72,
  L4_LEGAL: 168, // 7 days
};

export class DisputeEscalationService {
  /**
   * Create an escalation for a dispute.
   */
  async createEscalation(input: {
    disputeId: string;
    userId: string;
    merchantId: string;
    amount: number;
    reason: string;
  }): Promise<DisputeEscalation> {
    if (!input.reason || input.reason.length < 10) {
      throw new Error('Razon debe tener al menos 10 caracteres.');
    }

    const level: EscalationLevel = input.amount > 500000 ? 'L2_SUPPORT' : 'L1_AUTO';
    const slaHours = SLA_HOURS[level];
    const slaDeadline = new Date(Date.now() + slaHours * 60 * 60 * 1000).toISOString();

    const escalation: DisputeEscalation = {
      id: `esc_${Date.now().toString(36)}`,
      disputeId: input.disputeId,
      userId: input.userId,
      merchantId: input.merchantId,
      amount: input.amount,
      reason: input.reason,
      level,
      status: 'OPEN',
      slaDeadline,
      assignedTo: null,
      resolution: null,
      history: [{ level, timestamp: new Date().toISOString(), note: 'Escalacion creada' }],
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };

    await this.save(escalation);
    log.info('Escalation created', { escId: escalation.id, disputeId: input.disputeId, level, amount: input.amount });
    return escalation;
  }

  /**
   * Escalate to next level.
   */
  async escalateToNext(escId: string, note: string): Promise<DisputeEscalation | null> {
    const esc = await this.get(escId);
    if (!esc) return null;

    const levels: EscalationLevel[] = ['L1_AUTO', 'L2_SUPPORT', 'L3_COMPLIANCE', 'L4_LEGAL'];
    const currentIdx = levels.indexOf(esc.level);
    if (currentIdx >= levels.length - 1) return esc; // already at max

    const nextLevel = levels[currentIdx + 1];
    esc.level = nextLevel;
    esc.status = 'IN_PROGRESS';
    esc.slaDeadline = new Date(Date.now() + SLA_HOURS[nextLevel] * 60 * 60 * 1000).toISOString();
    esc.history.push({ level: nextLevel, timestamp: new Date().toISOString(), note });

    await this.save(esc);
    log.info('Escalation escalated', { escId, newLevel: nextLevel });
    return esc;
  }

  /**
   * Resolve an escalation.
   */
  async resolve(escId: string, resolution: string): Promise<DisputeEscalation | null> {
    const esc = await this.get(escId);
    if (!esc) return null;

    esc.status = 'RESOLVED';
    esc.resolution = resolution;
    esc.resolvedAt = new Date().toISOString();
    esc.history.push({ level: esc.level, timestamp: new Date().toISOString(), note: `Resuelto: ${resolution}` });

    await this.save(esc);
    log.info('Escalation resolved', { escId, level: esc.level });
    return esc;
  }

  /**
   * Assign to an agent.
   */
  async assign(escId: string, agentId: string): Promise<DisputeEscalation | null> {
    const esc = await this.get(escId);
    if (!esc) return null;

    esc.assignedTo = agentId;
    esc.status = 'IN_PROGRESS';
    esc.history.push({ level: esc.level, timestamp: new Date().toISOString(), note: `Asignado a ${agentId}` });

    await this.save(esc);
    return esc;
  }

  /**
   * Get an escalation.
   */
  async get(escId: string): Promise<DisputeEscalation | null> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${ESC_PREFIX}${escId}`);
      return raw ? JSON.parse(raw) as DisputeEscalation : null;
    } catch {
      return null;
    }
  }

  /**
   * Check if SLA is breached.
   */
  isSlaBreached(escalation: DisputeEscalation): boolean {
    if (escalation.status === 'RESOLVED' || escalation.status === 'CLOSED') return false;
    return new Date() > new Date(escalation.slaDeadline);
  }

  /**
   * Get escalation summary.
   */
  getSummary(esc: DisputeEscalation): string {
    const breach = this.isSlaBreached(esc) ? ' [SLA BREACH]' : '';
    return `${esc.id} — ${formatCLP(esc.amount)} — ${esc.level} — ${esc.status}${breach}`;
  }

  /**
   * Get SLA hours for a level.
   */
  getSlaHours(level: EscalationLevel): number {
    return SLA_HOURS[level];
  }

  private async save(esc: DisputeEscalation): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${ESC_PREFIX}${esc.id}`, JSON.stringify(esc), { EX: ESC_TTL });
    } catch (err) {
      log.warn('Failed to save escalation', { escId: esc.id, error: (err as Error).message });
    }
  }
}

export const disputeEscalation = new DisputeEscalationService();
