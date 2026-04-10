/**
 * TransactionCategoryService — auto-categorization + spending breakdown.
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

import { TransactionCategoryService, CATEGORY_LABELS } from '../../src/services/transaction-category.service';

describe('TransactionCategoryService', () => {
  let service: TransactionCategoryService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TransactionCategoryService();
    mockRedisGet.mockResolvedValue(null);
  });

  // ── autoCategorizeTx ──────────────────────────────

  it('categorizes food-related descriptions', () => {
    expect(service.autoCategorizeTx('Almuerzo con equipo').category).toBe('FOOD');
    expect(service.autoCategorizeTx('Pizza para la casa').category).toBe('FOOD');
    expect(service.autoCategorizeTx('Cafe y colacion').category).toBe('FOOD');
  });

  it('categorizes transport', () => {
    expect(service.autoCategorizeTx('Uber al aeropuerto').category).toBe('TRANSPORT');
    expect(service.autoCategorizeTx('Bencina copec').category).toBe('TRANSPORT');
  });

  it('categorizes entertainment', () => {
    expect(service.autoCategorizeTx('Netflix mensual').category).toBe('ENTERTAINMENT');
    expect(service.autoCategorizeTx('Entradas cine').category).toBe('ENTERTAINMENT');
  });

  it('categorizes bills', () => {
    expect(service.autoCategorizeTx('Cuenta de luz').category).toBe('BILLS');
    expect(service.autoCategorizeTx('Arriendo abril').category).toBe('BILLS');
  });

  it('categorizes health', () => {
    expect(service.autoCategorizeTx('Consulta dentista').category).toBe('HEALTH');
    expect(service.autoCategorizeTx('Farmacia remedios').category).toBe('HEALTH');
  });

  it('categorizes education', () => {
    expect(service.autoCategorizeTx('Matricula universidad').category).toBe('EDUCATION');
  });

  it('defaults to TRANSFER for empty description', () => {
    expect(service.autoCategorizeTx('').category).toBe('TRANSFER');
  });

  it('defaults to OTHER for unknown description', () => {
    expect(service.autoCategorizeTx('qwerty asdf').category).toBe('OTHER');
  });

  it('returns confidence 0.8 for keyword match', () => {
    expect(service.autoCategorizeTx('Pizza').confidence).toBe(0.8);
  });

  it('returns confidence 0.3 for OTHER', () => {
    expect(service.autoCategorizeTx('Unknown stuff').confidence).toBe(0.3);
  });

  // ── setCategoryManual ─────────────────────────────

  it('sets manual category', async () => {
    const entry = await service.setCategoryManual('u1', '#WP-123', 'FOOD');
    expect(entry.category).toBe('FOOD');
    expect(entry.confidence).toBe('MANUAL');
    expect(mockRedisSet).toHaveBeenCalled();
  });

  it('overrides existing category', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { transactionRef: '#WP-123', category: 'OTHER', confidence: 'AUTO' },
    ]));
    const entry = await service.setCategoryManual('u1', '#WP-123', 'SHOPPING');
    expect(entry.category).toBe('SHOPPING');
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved).toHaveLength(1);
    expect(saved[0].category).toBe('SHOPPING');
  });

  it('rejects invalid category', async () => {
    await expect(service.setCategoryManual('u1', '#WP-123', 'INVALID' as any))
      .rejects.toThrow('invalida');
  });

  // ── getCategory ───────────────────────────────────

  it('returns null for uncategorized tx', async () => {
    expect(await service.getCategory('u1', '#WP-123')).toBeNull();
  });

  it('returns stored category', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { transactionRef: '#WP-123', category: 'FOOD', confidence: 'MANUAL' },
    ]));
    const cat = await service.getCategory('u1', '#WP-123');
    expect(cat?.category).toBe('FOOD');
  });

  // ── getSpendingByCategory ─────────────────────────

  it('groups spending by category', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { transactionRef: 'ref1', category: 'FOOD' },
    ]));
    const result = await service.getSpendingByCategory('u1', [
      { ref: 'ref1', amount: 5000, description: 'Almuerzo' },
      { ref: 'ref2', amount: 3000, description: 'Uber centro' },
      { ref: 'ref3', amount: 2000, description: 'Random cosa' },
    ]);
    expect(result.FOOD).toBe(5000);
    expect(result.TRANSPORT).toBe(3000);
    expect(result.OTHER).toBe(2000);
  });

  // ── getCategoryLabel ──────────────────────────────

  it('returns Spanish label', () => {
    const { label, icon } = service.getCategoryLabel('FOOD', 'es');
    expect(label).toBe('Comida');
    expect(icon).toBe('🍔');
  });

  it('returns English label', () => {
    const { label } = service.getCategoryLabel('TRANSPORT', 'en');
    expect(label).toBe('Transport');
  });

  it('has all 10 categories defined', () => {
    expect(Object.keys(CATEGORY_LABELS)).toHaveLength(10);
  });
});
