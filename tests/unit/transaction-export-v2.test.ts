const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { TransactionExportV2Service } from '../../src/services/transaction-export-v2.service';

describe('TransactionExportV2Service', () => {
  let s: TransactionExportV2Service;
  beforeEach(() => { jest.clearAllMocks(); s = new TransactionExportV2Service(); mockRedisGet.mockResolvedValue(null); });

  it('creates export request', async () => { const e = await s.requestExport({ merchantId: 'm1', format: 'CSV', dateFrom: '2026-04-01', dateTo: '2026-04-30' }); expect(e.id).toMatch(/^exp_/); expect(e.status).toBe('PENDING'); expect(e.format).toBe('CSV'); });
  it('rejects invalid format', async () => { await expect(s.requestExport({ merchantId: 'm1', format: 'XML' as any, dateFrom: '2026-04-01', dateTo: '2026-04-30' })).rejects.toThrow('inválido'); });
  it('rejects reversed dates', async () => { await expect(s.requestExport({ merchantId: 'm1', format: 'CSV', dateFrom: '2026-04-30', dateTo: '2026-04-01' })).rejects.toThrow('anterior'); });
  it('rejects over 365 days', async () => { await expect(s.requestExport({ merchantId: 'm1', format: 'CSV', dateFrom: '2025-01-01', dateTo: '2026-04-30' })).rejects.toThrow('365'); });
  it('returns null for missing export', async () => { expect(await s.getExport('exp_nope')).toBeNull(); });
  it('marks completed', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'exp_1', status: 'PROCESSING' }));
    expect(await s.markCompleted('exp_1', 500, 'https://storage/file.csv')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.status).toBe('COMPLETED'); expect(saved.rowCount).toBe(500);
  });
  it('generates CSV header', () => { expect(s.generateCSVHeader()).toContain('Referencia'); expect(s.generateCSVHeader()).toContain('Método'); });
  it('formats export row', () => { const r = s.formatExportRow({ ref: '#WP-1', date: '2026-04-10', type: 'PAYMENT', amount: 10000, fee: 150, net: 9850, status: 'COMPLETED', counterparty: 'Juan', description: 'Café', method: 'WALLET' }); expect(r).toContain('$10.000'); expect(r).toContain('Café'); });
});
