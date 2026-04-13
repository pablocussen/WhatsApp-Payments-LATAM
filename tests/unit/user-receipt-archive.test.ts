const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserReceiptArchiveService } from '../../src/services/user-receipt-archive.service';

describe('UserReceiptArchiveService', () => {
  let s: UserReceiptArchiveService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserReceiptArchiveService(); mockRedisGet.mockResolvedValue(null); });

  const base = {
    userId: 'u1',
    transactionId: 'tx1',
    merchantName: 'Farmacia',
    amount: 15000,
    transactionDate: '2026-04-10T00:00:00.000Z',
    reason: 'TAX' as const,
  };

  it('archives receipt', async () => {
    const r = await s.archive(base);
    expect(r.starred).toBe(false);
    expect(r.reason).toBe('TAX');
  });

  it('rejects zero amount', async () => {
    await expect(s.archive({ ...base, amount: 0 })).rejects.toThrow('positivo');
  });

  it('rejects duplicate transaction', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ transactionId: 'tx1' }]));
    await expect(s.archive(base)).rejects.toThrow('ya archivada');
  });

  it('rejects over 500', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ transactionId: 'tx' + i }))));
    await expect(s.archive(base)).rejects.toThrow('500');
  });

  it('toggles star', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'r1', starred: false }]));
    const r = await s.toggleStar('u1', 'r1');
    expect(r?.starred).toBe(true);
  });

  it('removes receipt', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'r1' }, { id: 'r2' }]));
    expect(await s.remove('u1', 'r1')).toBe(true);
  });

  it('filters by reason', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'r1', reason: 'TAX' },
      { id: 'r2', reason: 'WARRANTY' },
      { id: 'r3', reason: 'TAX' },
    ]));
    const tax = await s.getByReason('u1', 'TAX');
    expect(tax).toHaveLength(2);
  });

  it('returns starred only', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'r1', starred: true },
      { id: 'r2', starred: false },
    ]));
    const starred = await s.getStarred('u1');
    expect(starred).toHaveLength(1);
  });

  it('filters by date range', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'r1', transactionDate: '2026-03-15T00:00:00.000Z' },
      { id: 'r2', transactionDate: '2026-04-10T00:00:00.000Z' },
      { id: 'r3', transactionDate: '2026-05-20T00:00:00.000Z' },
    ]));
    const filtered = await s.getByDateRange('u1', '2026-04-01', '2026-04-30');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe('r2');
  });

  it('computes tax summary for year', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { reason: 'TAX', amount: 10000, transactionDate: '2026-01-15T00:00:00.000Z' },
      { reason: 'TAX', amount: 25000, transactionDate: '2026-06-20T00:00:00.000Z' },
      { reason: 'TAX', amount: 50000, transactionDate: '2025-12-01T00:00:00.000Z' },
      { reason: 'WARRANTY', amount: 99999, transactionDate: '2026-05-01T00:00:00.000Z' },
    ]));
    const summary = await s.getTaxSummary('u1', 2026);
    expect(summary.count).toBe(2);
    expect(summary.total).toBe(35000);
  });
});
