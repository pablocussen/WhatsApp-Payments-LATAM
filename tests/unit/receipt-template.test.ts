/**
 * ReceiptTemplateService — plantillas de comprobantes personalizables.
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

import { ReceiptTemplateService } from '../../src/services/receipt-template.service';

describe('ReceiptTemplateService', () => {
  let service: ReceiptTemplateService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ReceiptTemplateService();
    mockRedisGet.mockResolvedValue(null);
  });

  it('creates template (first is default)', async () => {
    const t = await service.createTemplate({ merchantId: 'm1', name: 'Estándar' });
    expect(t.id).toMatch(/^rtpl_/);
    expect(t.name).toBe('Estándar');
    expect(t.isDefault).toBe(true);
    expect(t.showLogo).toBe(true);
    expect(t.thankYouMessage).toBe('Gracias por tu compra!');
  });

  it('second template is not default', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'rtpl_1', isDefault: true }]));
    const t = await service.createTemplate({ merchantId: 'm1', name: 'Promocional' });
    expect(t.isDefault).toBe(false);
  });

  it('rejects over 5 templates', async () => {
    const existing = Array.from({ length: 5 }, (_, i) => ({ id: `rtpl_${i}` }));
    mockRedisGet.mockResolvedValue(JSON.stringify(existing));
    await expect(service.createTemplate({ merchantId: 'm1', name: 'Extra' }))
      .rejects.toThrow('5');
  });

  it('gets default template', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'rtpl_1', isDefault: false },
      { id: 'rtpl_2', isDefault: true },
    ]));
    const d = await service.getDefault('m1');
    expect(d?.id).toBe('rtpl_2');
  });

  it('sets default template', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'rtpl_1', isDefault: true },
      { id: 'rtpl_2', isDefault: false },
    ]));
    expect(await service.setDefault('m1', 'rtpl_2')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].isDefault).toBe(false);
    expect(saved[1].isDefault).toBe(true);
  });

  it('adds custom field', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'rtpl_1', customFields: [] },
    ]));
    expect(await service.addCustomField('m1', 'rtpl_1', { key: 'rut', label: 'RUT Cliente', visible: true })).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].customFields).toHaveLength(1);
  });

  it('rejects over 5 custom fields', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'rtpl_1', customFields: Array.from({ length: 5 }, () => ({ key: 'x', label: 'x', visible: true })) },
    ]));
    expect(await service.addCustomField('m1', 'rtpl_1', { key: 'extra', label: 'Extra', visible: true })).toBe(false);
  });

  it('rejects deleting default with multiple templates', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'rtpl_1', isDefault: true },
      { id: 'rtpl_2', isDefault: false },
    ]));
    await expect(service.deleteTemplate('m1', 'rtpl_1')).rejects.toThrow('por defecto');
  });

  it('deletes non-default template', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'rtpl_1', isDefault: true },
      { id: 'rtpl_2', isDefault: false },
    ]));
    expect(await service.deleteTemplate('m1', 'rtpl_2')).toBe(true);
  });

  it('renders receipt', () => {
    const template = {
      id: 'rtpl_1', merchantId: 'm1', name: 'Test',
      headerText: '=== BOLETA ===', footerText: 'whatpay.cl',
      showLogo: true, showMerchantName: true, showDate: true,
      showReference: true, showBreakdown: true, customFields: [],
      thankYouMessage: 'Gracias!', isDefault: true, createdAt: '',
    };
    const receipt = service.renderReceipt(template, {
      amount: 15000, reference: '#WP-123', merchantName: 'Café Central',
      date: '11/04/2026', items: [{ name: 'Café', amount: 3000 }, { name: 'Torta', amount: 12000 }],
    });
    expect(receipt).toContain('=== BOLETA ===');
    expect(receipt).toContain('Café Central');
    expect(receipt).toContain('#WP-123');
    expect(receipt).toContain('$3.000');
    expect(receipt).toContain('$15.000');
    expect(receipt).toContain('Gracias!');
    expect(receipt).toContain('whatpay.cl');
  });
});
