const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserPaymentIntentService } from '../../src/services/user-payment-intent.service';

describe('UserPaymentIntentService', () => {
  let s: UserPaymentIntentService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserPaymentIntentService(); mockRedisGet.mockResolvedValue(null); });

  it('creates intent', async () => {
    const i = await s.createIntent({ userId: 'u1', recipientPhone: '+569', amount: 10000, description: 'Test' });
    expect(i.id).toMatch(/^pi_/);
    expect(i.status).toBe('CREATED');
    expect(i.confirmationCode).toHaveLength(4);
  });
  it('rejects below 100', async () => {
    await expect(s.createIntent({ userId: 'u1', recipientPhone: '+569', amount: 50, description: 'X' }))
      .rejects.toThrow('100');
  });
  it('rejects above 2M', async () => {
    await expect(s.createIntent({ userId: 'u1', recipientPhone: '+569', amount: 3000000, description: 'X' }))
      .rejects.toThrow('2.000.000');
  });
  it('confirms with valid code', async () => {
    const future = new Date(Date.now() + 600000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'pi_1', status: 'CREATED', confirmationCode: '1234', expiresAt: future }));
    const r = await s.confirmIntent('pi_1', '1234');
    expect(r.success).toBe(true);
    expect(r.intent?.status).toBe('CONFIRMED');
  });
  it('rejects wrong code', async () => {
    const future = new Date(Date.now() + 600000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'pi_1', status: 'CREATED', confirmationCode: '1234', expiresAt: future }));
    const r = await s.confirmIntent('pi_1', '9999');
    expect(r.success).toBe(false);
    expect(r.error).toContain('incorrecto');
  });
  it('rejects expired', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'pi_1', status: 'CREATED', confirmationCode: '1234', expiresAt: '2020-01-01' }));
    const r = await s.confirmIntent('pi_1', '1234');
    expect(r.success).toBe(false);
    expect(r.error).toContain('expirada');
  });
  it('returns error for missing intent', async () => {
    const r = await s.confirmIntent('nope', '1234');
    expect(r.success).toBe(false);
  });
  it('completes confirmed intent', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'pi_1', status: 'CONFIRMED' }));
    expect(await s.completeIntent('pi_1')).toBe(true);
    expect(JSON.parse(mockRedisSet.mock.calls[0][1]).status).toBe('COMPLETED');
  });
  it('cannot complete non-confirmed', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'pi_1', status: 'CREATED' }));
    expect(await s.completeIntent('pi_1')).toBe(false);
  });
  it('cancels intent', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'pi_1', status: 'CREATED' }));
    expect(await s.cancelIntent('pi_1')).toBe(true);
  });
  it('cannot cancel completed', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'pi_1', status: 'COMPLETED' }));
    expect(await s.cancelIntent('pi_1')).toBe(false);
  });
  it('formats summary', () => {
    const f = s.formatIntentSummary({ id: 'pi_1', amount: 15000, recipientPhone: '+569', status: 'CREATED' } as any);
    expect(f).toContain('$15.000');
    expect(f).toContain('CREATED');
  });
});
