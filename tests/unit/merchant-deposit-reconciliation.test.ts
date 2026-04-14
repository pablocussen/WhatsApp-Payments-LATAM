const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantDepositReconciliationService } from '../../src/services/merchant-deposit-reconciliation.service';

describe('MerchantDepositReconciliationService', () => {
  let s: MerchantDepositReconciliationService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantDepositReconciliationService(); mockRedisGet.mockResolvedValue(null); });

  const base = {
    merchantId: 'm1',
    expectedAmount: 500000,
    expectedDate: '2026-04-15T00:00:00Z',
    source: 'Transbank',
    reference: 'TB-123456',
  };

  it('creates expected deposit', async () => {
    const d = await s.expectDeposit(base);
    expect(d.status).toBe('PENDING');
  });

  it('rejects zero amount', async () => {
    await expect(s.expectDeposit({ ...base, expectedAmount: 0 })).rejects.toThrow('positivo');
  });

  it('rejects missing reference', async () => {
    await expect(s.expectDeposit({ ...base, reference: '' })).rejects.toThrow('Referencia');
  });

  it('rejects duplicate reference', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ reference: 'TB-123456', status: 'PENDING' }]));
    await expect(s.expectDeposit(base)).rejects.toThrow('ya existe');
  });

  it('matches within tolerance', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1', expectedAmount: 500000, status: 'PENDING' }]));
    const d = await s.matchTransaction('m1', 'd1', 'tx1', 500000);
    expect(d?.status).toBe('MATCHED');
    expect(d?.matchedTransactionId).toBe('tx1');
  });

  it('matches within tolerance with small diff', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1', expectedAmount: 500000, status: 'PENDING' }]));
    const d = await s.matchTransaction('m1', 'd1', 'tx1', 503000);
    expect(d?.status).toBe('MATCHED');
  });

  it('disputes when outside tolerance', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1', expectedAmount: 500000, status: 'PENDING' }]));
    const d = await s.matchTransaction('m1', 'd1', 'tx1', 480000);
    expect(d?.status).toBe('DISPUTED');
    expect(d?.notes).toContain('Diferencia');
  });

  it('rejects match on already matched', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1', status: 'MATCHED' }]));
    await expect(s.matchTransaction('m1', 'd1', 'tx1', 100)).rejects.toThrow('conciliado');
  });

  it('marks unmatched with reason', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'd1', status: 'PENDING' }]));
    const d = await s.markUnmatched('m1', 'd1', 'No aparece en estado de cuenta');
    expect(d?.status).toBe('UNMATCHED');
  });

  it('returns pending sorted by expected date', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'd1', status: 'PENDING', expectedDate: '2026-04-20' },
      { id: 'd2', status: 'MATCHED', expectedDate: '2026-04-10' },
      { id: 'd3', status: 'PENDING', expectedDate: '2026-04-15' },
    ]));
    const pending = await s.getPending('m1');
    expect(pending).toHaveLength(2);
    expect(pending[0].id).toBe('d3');
  });

  it('returns disputed deposits', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'DISPUTED' }, { status: 'MATCHED' }, { status: 'DISPUTED' },
    ]));
    expect((await s.getDisputed('m1'))).toHaveLength(2);
  });

  it('returns overdue pending', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'd1', status: 'PENDING', expectedDate: past },
      { id: 'd2', status: 'PENDING', expectedDate: future },
      { id: 'd3', status: 'MATCHED', expectedDate: past },
    ]));
    const overdue = await s.getOverdue('m1');
    expect(overdue).toHaveLength(1);
    expect(overdue[0].id).toBe('d1');
  });

  it('computes reconciliation rate', async () => {
    const recent = new Date().toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { status: 'MATCHED', createdAt: recent },
      { status: 'MATCHED', createdAt: recent },
      { status: 'MATCHED', createdAt: recent },
      { status: 'DISPUTED', createdAt: recent },
      { status: 'UNMATCHED', createdAt: recent },
      { status: 'PENDING', createdAt: recent },
    ]));
    const rate = await s.getReconciliationRate('m1');
    expect(rate.total).toBe(5);
    expect(rate.matched).toBe(3);
    expect(rate.rate).toBe(60);
  });
});
