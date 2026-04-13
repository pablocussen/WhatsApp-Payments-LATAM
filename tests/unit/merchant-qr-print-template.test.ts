const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantQRPrintTemplateService } from '../../src/services/merchant-qr-print-template.service';

describe('MerchantQRPrintTemplateService', () => {
  let s: MerchantQRPrintTemplateService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantQRPrintTemplateService(); mockRedisGet.mockResolvedValue(null); });

  it('creates template with defaults', async () => {
    const t = await s.create({ merchantId: 'm1', name: 'Caja', size: 'A6', style: 'BRANDED', headerText: 'Paga aqui', footerText: 'Gracias' });
    expect(t.primaryColor).toBe('#06b6d4');
    expect(t.showLogo).toBe(true);
    expect(t.downloads).toBe(0);
  });

  it('rejects invalid color', async () => {
    await expect(s.create({ merchantId: 'm1', name: 'x', size: 'A4', style: 'MINIMAL', headerText: 'a', footerText: 'b', primaryColor: 'red' })).rejects.toThrow('#RRGGBB');
  });

  it('rejects long name', async () => {
    await expect(s.create({ merchantId: 'm1', name: 'x'.repeat(41), size: 'A4', style: 'MINIMAL', headerText: 'a', footerText: 'b' })).rejects.toThrow('40');
  });

  it('rejects long header', async () => {
    await expect(s.create({ merchantId: 'm1', name: 'x', size: 'A4', style: 'MINIMAL', headerText: 'h'.repeat(61), footerText: 'b' })).rejects.toThrow('Encabezado');
  });

  it('rejects over 10 templates', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ id: 't' + i }))));
    await expect(s.create({ merchantId: 'm1', name: 'x', size: 'A4', style: 'MINIMAL', headerText: 'a', footerText: 'b' })).rejects.toThrow('10');
  });

  it('increments downloads', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 't1', downloads: 5 }]));
    const t = await s.incrementDownloads('m1', 't1');
    expect(t?.downloads).toBe(6);
  });

  it('deletes template', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 't1' }, { id: 't2' }]));
    expect(await s.delete('m1', 't1')).toBe(true);
  });

  it('returns most downloaded', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 't1', downloads: 5 },
      { id: 't2', downloads: 20 },
      { id: 't3', downloads: 10 },
    ]));
    const top = await s.getMostDownloaded('m1');
    expect(top?.id).toBe('t2');
  });

  it('returns null for empty list', async () => {
    expect(await s.getMostDownloaded('m1')).toBeNull();
  });

  it('formats print spec', () => {
    const spec = s.formatPrintSpec({ id: 't1', merchantId: 'm1', name: 'Caja', size: 'A6', style: 'BRANDED', headerText: '', footerText: '', showLogo: true, showAmount: false, primaryColor: '#06b6d4', downloads: 0, createdAt: '' });
    expect(spec).toContain('105x148mm');
    expect(spec).toContain('BRANDED');
  });
});
