/**
 * DisputeEscalationService — multi-level dispute escalation with SLA.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { DisputeEscalationService } from '../../src/services/dispute-escalation.service';

describe('DisputeEscalationService', () => {
  let service: DisputeEscalationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DisputeEscalationService();
    mockRedisGet.mockResolvedValue(null);
  });

  // ── createEscalation ──────────────────────────────

  it('creates L1 escalation for small amount', async () => {
    const esc = await service.createEscalation({
      disputeId: 'd1', userId: 'u1', merchantId: 'm1', amount: 10000, reason: 'No recibi el producto que pague',
    });
    expect(esc.id).toMatch(/^esc_/);
    expect(esc.level).toBe('L1_AUTO');
    expect(esc.status).toBe('OPEN');
    expect(esc.history).toHaveLength(1);
  });

  it('creates L2 escalation for large amount', async () => {
    const esc = await service.createEscalation({
      disputeId: 'd2', userId: 'u1', merchantId: 'm1', amount: 600000, reason: 'Cobro duplicado de servicio mensual',
    });
    expect(esc.level).toBe('L2_SUPPORT');
  });

  it('rejects short reason', async () => {
    await expect(service.createEscalation({
      disputeId: 'd1', userId: 'u1', merchantId: 'm1', amount: 5000, reason: 'corto',
    })).rejects.toThrow('10 caracteres');
  });

  it('sets SLA deadline based on level', async () => {
    const esc = await service.createEscalation({
      disputeId: 'd1', userId: 'u1', merchantId: 'm1', amount: 5000, reason: 'Producto defectuoso recibido',
    });
    const deadline = new Date(esc.slaDeadline);
    const now = new Date();
    const diffHours = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);
    expect(diffHours).toBeGreaterThan(1.5);
    expect(diffHours).toBeLessThan(2.5);
  });

  // ── escalateToNext ────────────────────────────────

  it('escalates from L1 to L2', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      id: 'esc_1', level: 'L1_AUTO', status: 'OPEN', history: [],
    }));
    const esc = await service.escalateToNext('esc_1', 'No se resolvio automaticamente');
    expect(esc?.level).toBe('L2_SUPPORT');
    expect(esc?.status).toBe('IN_PROGRESS');
    expect(esc?.history).toHaveLength(1);
  });

  it('does not escalate beyond L4', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      id: 'esc_1', level: 'L4_LEGAL', status: 'IN_PROGRESS', history: [],
    }));
    const esc = await service.escalateToNext('esc_1', 'Maximo nivel');
    expect(esc?.level).toBe('L4_LEGAL');
  });

  it('returns null for missing escalation', async () => {
    expect(await service.escalateToNext('esc_unknown', 'test')).toBeNull();
  });

  // ── resolve ───────────────────────────────────────

  it('resolves an escalation', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      id: 'esc_1', level: 'L2_SUPPORT', status: 'IN_PROGRESS', history: [],
    }));
    const esc = await service.resolve('esc_1', 'Reembolso aprobado');
    expect(esc?.status).toBe('RESOLVED');
    expect(esc?.resolution).toBe('Reembolso aprobado');
    expect(esc?.resolvedAt).toBeDefined();
  });

  // ── assign ────────────────────────────────────────

  it('assigns to agent', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      id: 'esc_1', level: 'L2_SUPPORT', status: 'OPEN', history: [], assignedTo: null,
    }));
    const esc = await service.assign('esc_1', 'agent-01');
    expect(esc?.assignedTo).toBe('agent-01');
    expect(esc?.status).toBe('IN_PROGRESS');
  });

  // ── isSlaBreached ─────────────────────────────────

  it('detects SLA breach', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(service.isSlaBreached({ slaDeadline: past, status: 'OPEN' } as any)).toBe(true);
  });

  it('no breach when resolved', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    expect(service.isSlaBreached({ slaDeadline: past, status: 'RESOLVED' } as any)).toBe(false);
  });

  it('no breach when within SLA', () => {
    const future = new Date(Date.now() + 100000).toISOString();
    expect(service.isSlaBreached({ slaDeadline: future, status: 'OPEN' } as any)).toBe(false);
  });

  // ── getSummary ────────────────────────────────────

  it('formats summary', () => {
    const summary = service.getSummary({
      id: 'esc_1', amount: 50000, level: 'L2_SUPPORT', status: 'IN_PROGRESS',
      slaDeadline: new Date(Date.now() + 100000).toISOString(),
    } as any);
    expect(summary).toContain('$50.000');
    expect(summary).toContain('L2_SUPPORT');
    expect(summary).not.toContain('SLA BREACH');
  });

  // ── getSlaHours ───────────────────────────────────

  it('returns correct SLA hours', () => {
    expect(service.getSlaHours('L1_AUTO')).toBe(2);
    expect(service.getSlaHours('L2_SUPPORT')).toBe(24);
    expect(service.getSlaHours('L3_COMPLIANCE')).toBe(72);
    expect(service.getSlaHours('L4_LEGAL')).toBe(168);
  });
});
