/**
 * LinkTemplateService — reusable payment link templates.
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

import { LinkTemplateService } from '../../src/services/link-template.service';

describe('LinkTemplateService', () => {
  let service: LinkTemplateService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LinkTemplateService();
    mockRedisGet.mockResolvedValue(null);
  });

  // ── createTemplate ────────────────────────────────

  it('creates a template', async () => {
    const tpl = await service.createTemplate({
      merchantId: 'm1', name: 'Almuerzo', amount: 8500, description: 'Menu del dia',
    });
    expect(tpl.id).toMatch(/^tpl_/);
    expect(tpl.name).toBe('Almuerzo');
    expect(tpl.amount).toBe(8500);
    expect(tpl.usageCount).toBe(0);
  });

  it('rejects empty name', async () => {
    await expect(service.createTemplate({ merchantId: 'm1', name: '' }))
      .rejects.toThrow('Nombre');
  });

  it('rejects over 20 templates', async () => {
    const existing = Array.from({ length: 20 }, (_, i) => ({ id: `tpl_${i}`, merchantId: 'm1', name: `T${i}` }));
    mockRedisGet.mockResolvedValue(JSON.stringify(existing));
    await expect(service.createTemplate({ merchantId: 'm1', name: 'Extra' }))
      .rejects.toThrow('20');
  });

  it('defaults expiresInHours to 24', async () => {
    const tpl = await service.createTemplate({ merchantId: 'm1', name: 'Test' });
    expect(tpl.expiresInHours).toBe(24);
  });

  // ── getTemplates ──────────────────────────────────

  it('returns empty for new merchant', async () => {
    const result = await service.getTemplates('m1');
    expect(result).toEqual([]);
  });

  it('returns stored templates', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'tpl_1', name: 'A' }]));
    const result = await service.getTemplates('m1');
    expect(result).toHaveLength(1);
  });

  // ── deleteTemplate ────────────────────────────────

  it('deletes a template', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'tpl_1', name: 'A' }, { id: 'tpl_2', name: 'B' },
    ]));
    const result = await service.deleteTemplate('m1', 'tpl_1');
    expect(result).toBe(true);
    const stored = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe('tpl_2');
  });

  it('returns false for non-existent template', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([]));
    expect(await service.deleteTemplate('m1', 'nonexistent')).toBe(false);
  });

  // ── recordUsage ───────────────────────────────────

  it('increments usage count', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'tpl_1', merchantId: 'm1', usageCount: 5 },
    ]));
    await service.recordUsage('m1', 'tpl_1');
    const stored = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(stored[0].usageCount).toBe(6);
  });

  // ── getTemplateSummary ────────────────────────────

  it('formats summary with name and amount', () => {
    const summary = service.getTemplateSummary({
      id: 'tpl_1', merchantId: 'm1', name: 'Almuerzo', amount: 8500,
      description: 'Menu', expiresInHours: 24, maxUses: null, usageCount: 0, createdAt: '',
    });
    expect(summary).toBe('Almuerzo — $8.500 — Menu');
  });

  it('formats summary without amount', () => {
    const summary = service.getTemplateSummary({
      id: 'tpl_1', merchantId: 'm1', name: 'Donacion', amount: null,
      description: null, expiresInHours: 24, maxUses: null, usageCount: 0, createdAt: '',
    });
    expect(summary).toBe('Donacion');
  });
});
