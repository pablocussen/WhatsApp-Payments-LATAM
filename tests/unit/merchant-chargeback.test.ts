const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantChargebackService } from '../../src/services/merchant-chargeback.service';

describe('MerchantChargebackService', () => {
  let s: MerchantChargebackService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantChargebackService(); mockRedisGet.mockResolvedValue(null); });

  it('creates chargeback', async () => {
    const cb = await s.createChargeback({ merchantId: 'm1', transactionRef: '#WP-1', amount: 50000, reason: 'NOT_RECEIVED', customerClaim: 'No recibi el producto que pague' });
    expect(cb.id).toMatch(/^cb_/);
    expect(cb.status).toBe('NEW');
  });
  it('rejects short claim', async () => {
    await expect(s.createChargeback({ merchantId: 'm1', transactionRef: '#WP-1', amount: 5000, reason: 'FRAUD', customerClaim: 'corto' }))
      .rejects.toThrow('20');
  });
  it('submits response', async () => {
    const future = new Date(Date.now() + 600000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'cb_1', status: 'NEW', deadlineAt: future }));
    expect(await s.submitResponse('cb_1', 'Producto fue entregado el 10 de abril a las 14:00', ['url1'])).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.status).toBe('CONTESTED');
  });
  it('rejects response after deadline', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'cb_1', status: 'NEW', deadlineAt: '2020-01-01' }));
    expect(await s.submitResponse('cb_1', 'Tengo evidencia clara del envio realizado', [])).toBe(false);
  });
  it('accepts chargeback', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'cb_1', status: 'NEW' }));
    expect(await s.acceptChargeback('cb_1')).toBe(true);
    expect(JSON.parse(mockRedisSet.mock.calls[0][1]).status).toBe('ACCEPTED');
  });
  it('resolves in favor of merchant', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'cb_1', status: 'CONTESTED' }));
    expect(await s.resolveInFavor('cb_1', true)).toBe(true);
    expect(JSON.parse(mockRedisSet.mock.calls[0][1]).status).toBe('REJECTED');
  });
  it('resolves against merchant', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'cb_1', status: 'CONTESTED' }));
    expect(await s.resolveInFavor('cb_1', false)).toBe(true);
    expect(JSON.parse(mockRedisSet.mock.calls[0][1]).status).toBe('ACCEPTED');
  });
  it('detects past deadline', () => {
    expect(s.isPastDeadline({ deadlineAt: '2020-01-01' } as any)).toBe(true);
    expect(s.isPastDeadline({ deadlineAt: new Date(Date.now() + 100000).toISOString() } as any)).toBe(false);
  });
  it('formats summary', () => {
    const f = s.formatChargebackSummary({ id: 'cb_1', amount: 50000, reason: 'FRAUD', status: 'NEW' } as any);
    expect(f).toContain('$50.000');
    expect(f).toContain('FRAUD');
  });
});
