const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantCatalogImportService } from '../../src/services/merchant-catalog-import.service';

describe('MerchantCatalogImportService', () => {
  let s: MerchantCatalogImportService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantCatalogImportService(); mockRedisGet.mockResolvedValue(null); });

  const validRows = [
    { sku: 'SKU1', name: 'Cafe', price: 2500, stock: 50 },
    { sku: 'SKU2', name: 'Torta', price: 5000, stock: 20 },
  ];

  it('parses valid catalog', async () => {
    const job = await s.parseAndValidate({
      merchantId: 'm1',
      filename: 'catalog.csv',
      rows: validRows,
    });
    expect(job.status).toBe('VALIDATED');
    expect(job.validRows).toBe(2);
    expect(job.invalidRows).toBe(0);
  });

  it('detects duplicate SKUs', async () => {
    const job = await s.parseAndValidate({
      merchantId: 'm1',
      filename: 'catalog.csv',
      rows: [
        ...validRows,
        { sku: 'SKU1', name: 'Otro', price: 100, stock: 1 },
      ],
    });
    expect(job.invalidRows).toBe(1);
    expect(job.rows[2].errors).toContain('SKU duplicado');
  });

  it('detects invalid price', async () => {
    const job = await s.parseAndValidate({
      merchantId: 'm1',
      filename: 'catalog.csv',
      rows: [{ sku: 'X', name: 'Y', price: -100, stock: 10 }],
    });
    expect(job.invalidRows).toBe(1);
  });

  it('detects empty name', async () => {
    const job = await s.parseAndValidate({
      merchantId: 'm1',
      filename: 'catalog.csv',
      rows: [{ sku: 'X', name: '', price: 100, stock: 10 }],
    });
    expect(job.rows[0].errors).toContain('Nombre vacio');
  });

  it('rejects empty file', async () => {
    await expect(s.parseAndValidate({ merchantId: 'm1', filename: 'empty.csv', rows: [] })).rejects.toThrow('sin filas');
  });

  it('rejects over 10k rows', async () => {
    const rows = Array.from({ length: 10001 }, (_, i) => ({
      sku: `S${i}`, name: `P${i}`, price: 100, stock: 1,
    }));
    await expect(s.parseAndValidate({ merchantId: 'm1', filename: 'big.csv', rows })).rejects.toThrow('10.000');
  });

  it('commits with skipInvalid', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'i1', status: 'VALIDATED', validRows: 5, invalidRows: 2, rows: [],
    }]));
    const job = await s.commit('m1', 'i1', true);
    expect(job?.status).toBe('COMPLETED');
    expect(job?.importedRows).toBe(5);
  });

  it('rejects commit without skipInvalid when errors exist', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'i1', status: 'VALIDATED', validRows: 5, invalidRows: 2, rows: [],
    }]));
    await expect(s.commit('m1', 'i1', false)).rejects.toThrow('2 filas');
  });

  it('marks failed with reason', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'i1', status: 'VALIDATED' }]));
    const job = await s.markFailed('m1', 'i1', 'DB timeout');
    expect(job?.status).toBe('FAILED');
  });

  it('rejects fail on completed', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'i1', status: 'COMPLETED' }]));
    await expect(s.markFailed('m1', 'i1', 'x')).rejects.toThrow('completado');
  });

  it('returns only errors', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{
      id: 'i1',
      rows: [
        { valid: true }, { valid: false, errors: ['SKU vacio'] }, { valid: false, errors: ['Precio invalido'] },
      ],
    }]));
    const errors = await s.getErrors('m1', 'i1');
    expect(errors).toHaveLength(2);
  });

  it('returns recent jobs sorted desc', async () => {
    const older = new Date(Date.now() - 3600000).toISOString();
    const newer = new Date().toISOString();
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'i1', createdAt: older },
      { id: 'i2', createdAt: newer },
    ]));
    const recent = await s.getRecent('m1', 5);
    expect(recent[0].id).toBe('i2');
  });
});
