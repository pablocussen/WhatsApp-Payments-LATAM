const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { UserTaxDocumentService } from '../../src/services/user-tax-document.service';

describe('UserTaxDocumentService', () => {
  let s: UserTaxDocumentService;
  beforeEach(() => { jest.clearAllMocks(); s = new UserTaxDocumentService(); mockRedisGet.mockResolvedValue(null); });

  it('generates summary', async () => {
    const sum = await s.generateSummary('u1', 2025, {
      received: 5000000, sent: 3000000, transactions: 150,
      categories: { FOOD: 500000, TRANSPORT: 300000, BILLS: 1000000 },
      counterparts: { '+569A': 500000, '+569B': 200000 },
    });
    expect(sum.totalNet).toBe(2000000);
    expect(sum.topCategories[0].category).toBe('BILLS');
    expect(sum.topCounterparts[0].phone).toBe('+569A');
  });

  it('rejects invalid year', async () => {
    await expect(s.generateSummary('u1', 2010, { received: 0, sent: 0, transactions: 0, categories: {}, counterparts: {} }))
      .rejects.toThrow('invalido');
  });

  it('returns null for missing', async () => {
    expect(await s.getSummary('u1', 2025)).toBeNull();
  });

  it('returns stored', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ year: 2025, totalNet: 1000000 }));
    const sum = await s.getSummary('u1', 2025);
    expect(sum?.totalNet).toBe(1000000);
  });

  it('limits top to 10', async () => {
    const categories: Record<string, number> = {};
    for (let i = 0; i < 20; i++) categories['CAT' + i] = 1000 * (20 - i);
    const sum = await s.generateSummary('u1', 2025, { received: 0, sent: 0, transactions: 0, categories, counterparts: {} });
    expect(sum.topCategories).toHaveLength(10);
  });

  it('formats summary', () => {
    const f = s.formatSummary({
      userId: 'u1', year: 2025, totalReceived: 5000000, totalSent: 3000000,
      totalNet: 2000000, transactionCount: 150,
      topCategories: [{ category: 'BILLS', amount: 1000000 }, { category: 'FOOD', amount: 500000 }, { category: 'TRANSPORT', amount: 300000 }],
      topCounterparts: [], generatedAt: '',
    });
    expect(f).toContain('2025');
    expect(f).toContain('$5.000.000');
    expect(f).toContain('$2.000.000');
    expect(f).toContain('BILLS');
  });
});
