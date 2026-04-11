/**
 * MerchantInvoiceService — facturación para comercios.
 */

const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
const mockRedisLRange = jest.fn().mockResolvedValue([]);

jest.mock('../../src/config/database', () => ({
  getRedis: jest.fn().mockReturnValue({
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    lRange: (...args: unknown[]) => mockRedisLRange(...args),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

import { MerchantInvoiceService } from '../../src/services/merchant-invoice.service';

describe('MerchantInvoiceService', () => {
  let service: MerchantInvoiceService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MerchantInvoiceService();
    mockRedisGet.mockResolvedValue(null);
  });

  it('creates invoice with IVA', async () => {
    const inv = await service.createInvoice({
      merchantId: 'm1', customerPhone: '+569123',
      items: [{ description: 'Servicio web', quantity: 1, unitPrice: 100000 }],
    });
    expect(inv.id).toMatch(/^inv_/);
    expect(inv.subtotal).toBe(100000);
    expect(inv.tax).toBe(19000);
    expect(inv.total).toBe(119000);
    expect(inv.status).toBe('DRAFT');
    expect(inv.items).toHaveLength(1);
  });

  it('creates invoice without IVA', async () => {
    const inv = await service.createInvoice({
      merchantId: 'm1', customerPhone: '+569123',
      items: [{ description: 'Producto', quantity: 2, unitPrice: 5000 }],
      includeTax: false,
    });
    expect(inv.subtotal).toBe(10000);
    expect(inv.tax).toBe(0);
    expect(inv.total).toBe(10000);
  });

  it('calculates multiple items', async () => {
    const inv = await service.createInvoice({
      merchantId: 'm1', customerPhone: '+569123',
      items: [
        { description: 'Item A', quantity: 3, unitPrice: 10000 },
        { description: 'Item B', quantity: 1, unitPrice: 25000 },
      ],
      includeTax: false,
    });
    expect(inv.subtotal).toBe(55000);
    expect(inv.items[0].total).toBe(30000);
    expect(inv.items[1].total).toBe(25000);
  });

  it('rejects empty items', async () => {
    await expect(service.createInvoice({
      merchantId: 'm1', customerPhone: '+569', items: [],
    })).rejects.toThrow('al menos un');
  });

  it('rejects over 20 items', async () => {
    const items = Array.from({ length: 21 }, (_, i) => ({ description: `Item ${i}`, quantity: 1, unitPrice: 100 }));
    await expect(service.createInvoice({
      merchantId: 'm1', customerPhone: '+569', items,
    })).rejects.toThrow('20');
  });

  it('returns null for non-existent invoice', async () => {
    expect(await service.getInvoice('inv_nope')).toBeNull();
  });

  it('marks invoice as sent', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'inv_1', status: 'DRAFT' }));
    expect(await service.markSent('inv_1')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.status).toBe('SENT');
  });

  it('marks invoice as paid', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'inv_1', status: 'SENT', paidAt: null }));
    expect(await service.markPaid('inv_1', '#WP-PAY-123')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.status).toBe('PAID');
    expect(saved.paymentRef).toBe('#WP-PAY-123');
    expect(saved.paidAt).toBeDefined();
  });

  it('cancels invoice', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'inv_1', status: 'DRAFT' }));
    expect(await service.cancel('inv_1')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.status).toBe('CANCELLED');
  });

  it('formats summary', () => {
    const summary = service.getInvoiceSummary({
      id: 'inv_1', merchantId: 'm1', customerPhone: '+569', customerName: 'Juan',
      items: [], subtotal: 100000, tax: 19000, total: 119000, status: 'SENT',
      dueDate: '', paidAt: null, paymentRef: null, notes: null, createdAt: '',
    });
    expect(summary).toContain('inv_1');
    expect(summary).toContain('Juan');
    expect(summary).toContain('$119.000');
    expect(summary).toContain('SENT');
  });

  it('sets custom due days', async () => {
    const inv = await service.createInvoice({
      merchantId: 'm1', customerPhone: '+569',
      items: [{ description: 'Test', quantity: 1, unitPrice: 1000 }],
      dueDays: 7,
    });
    const due = new Date(inv.dueDate);
    const now = new Date();
    const diffDays = Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBeGreaterThanOrEqual(6);
    expect(diffDays).toBeLessThanOrEqual(8);
  });
});
