/**
 * AMLRulesService — reglas anti lavado de dinero.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisLPush = jest.fn().mockResolvedValue(1);

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    lPush: (...args: unknown[]) => mockRedisLPush(...args),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { AMLRulesService } from '../../src/services/aml-rules.service';

describe('AMLRulesService', () => {
  let service: AMLRulesService;
  const baseContext = { txCountLastHour: 1, txCountToday: 1, dailyVolume: 0, isNewRecipient: false, accountAgeDays: 90 };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AMLRulesService();
    mockRedisGet.mockResolvedValue(null);
  });

  it('triggers UAF alert for amount > UF 450', () => {
    const alerts = service.evaluateTransaction(18_000_000, 'u1', baseContext);
    const uaf = alerts.find(a => a.ruleTriggered === 'UAF_THRESHOLD');
    expect(uaf).toBeDefined();
    expect(uaf?.level).toBe('CRITICAL');
  });

  it('does not trigger UAF for small amount', () => {
    const alerts = service.evaluateTransaction(100_000, 'u1', baseContext);
    expect(alerts.find(a => a.ruleTriggered === 'UAF_THRESHOLD')).toBeUndefined();
  });

  it('triggers structuring alert', () => {
    const alerts = service.evaluateTransaction(16_000_000, 'u1', { ...baseContext, txCountToday: 4 });
    const structuring = alerts.find(a => a.ruleTriggered === 'STRUCTURING');
    expect(structuring).toBeDefined();
    expect(structuring?.level).toBe('HIGH');
  });

  it('triggers velocity alert', () => {
    const alerts = service.evaluateTransaction(50_000, 'u1', { ...baseContext, txCountLastHour: 25 });
    const velocity = alerts.find(a => a.ruleTriggered === 'VELOCITY');
    expect(velocity).toBeDefined();
    expect(velocity?.level).toBe('MEDIUM');
  });

  it('triggers round amount alert', () => {
    const alerts = service.evaluateTransaction(5_000_000, 'u1', baseContext);
    const round = alerts.find(a => a.ruleTriggered === 'ROUND_AMOUNT');
    expect(round).toBeDefined();
  });

  it('triggers new account + high value alert', () => {
    const alerts = service.evaluateTransaction(2_000_000, 'u1', { ...baseContext, accountAgeDays: 3 });
    const newAcc = alerts.find(a => a.ruleTriggered === 'NEW_ACCOUNT_HIGH_VALUE');
    expect(newAcc).toBeDefined();
    expect(newAcc?.level).toBe('HIGH');
  });

  it('triggers daily volume spike', () => {
    const alerts = service.evaluateTransaction(1_000_000, 'u1', { ...baseContext, dailyVolume: 13_000_000 });
    const spike = alerts.find(a => a.ruleTriggered === 'DAILY_VOLUME_SPIKE');
    expect(spike).toBeDefined();
  });

  it('no alerts for normal transaction', () => {
    const alerts = service.evaluateTransaction(15_000, 'u1', baseContext);
    expect(alerts).toHaveLength(0);
  });

  it('saves alert to Redis', async () => {
    const alerts = service.evaluateTransaction(18_000_000, 'u1', baseContext);
    await service.saveAlert(alerts[0]);
    expect(mockRedisSet).toHaveBeenCalled();
    expect(mockRedisLPush).toHaveBeenCalled();
  });

  it('reviews and dismisses alert', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      id: 'aml_1', status: 'PENDING', ruleTriggered: 'VELOCITY',
    }));
    const reviewed = await service.reviewAlert('aml_1', 'admin-01', 'Falso positivo', true);
    expect(reviewed?.status).toBe('DISMISSED');
    expect(reviewed?.reviewedBy).toBe('admin-01');
  });

  it('reviews and escalates alert', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({
      id: 'aml_1', status: 'PENDING', ruleTriggered: 'UAF_THRESHOLD',
    }));
    const reviewed = await service.reviewAlert('aml_1', 'admin-01', 'Reportar a UAF', false);
    expect(reviewed?.status).toBe('ESCALATED');
  });

  it('checks UAF requirement', () => {
    expect(service.requiresUAFReport(18_000_000)).toBe(true);
    expect(service.requiresUAFReport(10_000_000)).toBe(false);
  });

  it('formats alert summary', () => {
    const summary = service.getAlertSummary({
      id: 'aml_1', userId: 'u1', ruleTriggered: 'UAF_THRESHOLD', level: 'CRITICAL',
      status: 'PENDING', amount: 18_000_000, description: '', transactionRef: null,
      reviewedBy: null, reviewNote: null, createdAt: '', reviewedAt: null,
    });
    expect(summary).toContain('[CRITICAL]');
    expect(summary).toContain('UAF_THRESHOLD');
    expect(summary).toContain('$18.000.000');
  });
});
