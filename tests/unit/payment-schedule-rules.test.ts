/**
 * PaymentScheduleRulesService — reglas avanzadas de pago recurrente.
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

import { PaymentScheduleRulesService } from '../../src/services/payment-schedule-rules.service';

describe('PaymentScheduleRulesService', () => {
  let service: PaymentScheduleRulesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PaymentScheduleRulesService();
    mockRedisGet.mockResolvedValue(null);
  });

  it('creates FIXED_DAY rule', async () => {
    const r = await service.createRule({
      userId: 'u1', recipientPhone: '+569123', amount: 500000,
      description: 'Arriendo', ruleType: 'FIXED_DAY', dayOfMonth: 5,
    });
    expect(r.id).toMatch(/^rule_/);
    expect(r.ruleType).toBe('FIXED_DAY');
    expect(r.dayOfMonth).toBe(5);
    expect(r.status).toBe('ACTIVE');
  });

  it('creates BIWEEKLY rule', async () => {
    const r = await service.createRule({
      userId: 'u1', recipientPhone: '+569123', amount: 50000,
      description: 'Quincena', ruleType: 'BIWEEKLY',
    });
    expect(r.ruleType).toBe('BIWEEKLY');
  });

  it('creates AFTER_DAYS rule', async () => {
    const r = await service.createRule({
      userId: 'u1', recipientPhone: '+569123', amount: 10000,
      description: 'Semanal', ruleType: 'AFTER_DAYS', intervalDays: 7,
    });
    expect(r.intervalDays).toBe(7);
  });

  it('rejects amount below 100', async () => {
    await expect(service.createRule({
      userId: 'u1', recipientPhone: '+569', amount: 50,
      description: 'Test', ruleType: 'BIWEEKLY',
    })).rejects.toThrow('$100');
  });

  it('rejects FIXED_DAY without valid day', async () => {
    await expect(service.createRule({
      userId: 'u1', recipientPhone: '+569', amount: 1000,
      description: 'Test', ruleType: 'FIXED_DAY', dayOfMonth: 30,
    })).rejects.toThrow('28');
  });

  it('rejects over 15 rules', async () => {
    const existing = Array.from({ length: 15 }, (_, i) => ({ id: `rule_${i}` }));
    mockRedisGet.mockResolvedValue(JSON.stringify(existing));
    await expect(service.createRule({
      userId: 'u1', recipientPhone: '+569', amount: 1000,
      description: 'Extra', ruleType: 'BIWEEKLY',
    })).rejects.toThrow('15');
  });

  it('returns due rules', async () => {
    const past = new Date(Date.now() - 10000).toISOString();
    const future = new Date(Date.now() + 100000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'r1', status: 'ACTIVE', nextExecution: past, maxExecutions: null, endDate: null, executionCount: 0 },
      { id: 'r2', status: 'ACTIVE', nextExecution: future, maxExecutions: null, endDate: null, executionCount: 0 },
      { id: 'r3', status: 'PAUSED', nextExecution: past, maxExecutions: null, endDate: null, executionCount: 0 },
    ]));
    const due = await service.getDueRules('u1');
    expect(due).toHaveLength(1);
    expect(due[0].id).toBe('r1');
  });

  it('marks executed and advances next', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'r1', ruleType: 'AFTER_DAYS', intervalDays: 7, executionCount: 2, maxExecutions: null, status: 'ACTIVE' },
    ]));
    expect(await service.markExecuted('u1', 'r1')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].executionCount).toBe(3);
    expect(saved[0].lastExecutedAt).toBeDefined();
  });

  it('completes after max executions', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'r1', ruleType: 'BIWEEKLY', executionCount: 11, maxExecutions: 12, status: 'ACTIVE' },
    ]));
    await service.markExecuted('u1', 'r1');
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].status).toBe('COMPLETED');
  });

  it('pauses rule', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'r1', status: 'ACTIVE' }]));
    expect(await service.pauseRule('u1', 'r1')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].status).toBe('PAUSED');
  });

  it('resumes paused rule', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'r1', status: 'PAUSED', ruleType: 'BIWEEKLY' },
    ]));
    expect(await service.resumeRule('u1', 'r1')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].status).toBe('ACTIVE');
  });

  it('cancels rule', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'r1', status: 'ACTIVE' }]));
    expect(await service.cancelRule('u1', 'r1')).toBe(true);
  });

  it('formats summary', () => {
    const summary = service.getRuleSummary({
      id: 'r1', userId: 'u1', recipientPhone: '+569', recipientName: 'Juan',
      amount: 500000, description: 'Arriendo', ruleType: 'FIXED_DAY', dayOfMonth: 5,
      intervalDays: null, startDate: '', endDate: null, nextExecution: '',
      executionCount: 3, maxExecutions: 12, status: 'ACTIVE', lastExecutedAt: null, createdAt: '',
    });
    expect(summary).toContain('Arriendo');
    expect(summary).toContain('$500.000');
    expect(summary).toContain('Juan');
    expect(summary).toContain('Día 5');
  });
});
