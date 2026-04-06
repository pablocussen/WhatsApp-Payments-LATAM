/**
 * TransactionSearchService — advanced search with filters.
 */

const mockQueryRawUnsafe = jest.fn();

jest.mock('../../src/config/database', () => ({
  prisma: {
    $queryRawUnsafe: (...args: unknown[]) => mockQueryRawUnsafe(...args),
    $queryRaw: jest.fn().mockResolvedValue([]),
  },
  getRedis: jest.fn().mockReturnValue({
    get: jest.fn(), set: jest.fn(), del: jest.fn(),
    multi: jest.fn().mockReturnValue({ incr: jest.fn().mockReturnThis(), expire: jest.fn().mockReturnThis(), exec: jest.fn().mockResolvedValue([0, 0]) }),
  }),
}));

jest.mock('../../src/config/logger', () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
}));

jest.mock('../../src/config/environment', () => ({
  env: { NODE_ENV: 'test' },
}));

import { TransactionSearchService } from '../../src/services/transaction-search.service';

describe('TransactionSearchService', () => {
  let service: TransactionSearchService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TransactionSearchService();
    // Default: count returns 0, data returns []
    mockQueryRawUnsafe
      .mockResolvedValueOnce([{ total: 0 }])  // count query
      .mockResolvedValueOnce([]);               // data query
  });

  it('returns empty result for no matches', async () => {
    const result = await service.search({ userId: 'user-1' });
    expect(result.transactions).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.page).toBe(1);
  });

  it('includes userId in WHERE clause', async () => {
    await service.search({ userId: 'user-1' });
    const countQuery = mockQueryRawUnsafe.mock.calls[0][0] as string;
    expect(countQuery).toContain('senderId');
    expect(countQuery).toContain('receiverId');
    expect(mockQueryRawUnsafe.mock.calls[0][1]).toBe('user-1');
  });

  it('adds status filter when provided', async () => {
    await service.search({ userId: 'user-1', status: 'COMPLETED' });
    const query = mockQueryRawUnsafe.mock.calls[0][0] as string;
    expect(query).toContain('"status"');
    expect(mockQueryRawUnsafe.mock.calls[0][2]).toBe('COMPLETED');
  });

  it('adds minAmount filter', async () => {
    await service.search({ userId: 'user-1', minAmount: 5000 });
    const query = mockQueryRawUnsafe.mock.calls[0][0] as string;
    expect(query).toContain('>=');
    expect(mockQueryRawUnsafe.mock.calls[0][2]).toBe(5000);
  });

  it('adds maxAmount filter', async () => {
    await service.search({ userId: 'user-1', maxAmount: 100000 });
    const query = mockQueryRawUnsafe.mock.calls[0][0] as string;
    expect(query).toContain('<=');
  });

  it('adds date range filters', async () => {
    await service.search({
      userId: 'user-1',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });
    const query = mockQueryRawUnsafe.mock.calls[0][0] as string;
    expect(query).toContain('createdAt');
    expect(query).toContain('timestamptz');
  });

  it('adds reference filter with ILIKE', async () => {
    await service.search({ userId: 'user-1', reference: 'WP-2026' });
    const query = mockQueryRawUnsafe.mock.calls[0][0] as string;
    expect(query).toContain('ILIKE');
  });

  it('paginates correctly', async () => {
    mockQueryRawUnsafe.mockReset();
    mockQueryRawUnsafe
      .mockResolvedValueOnce([{ total: 50 }])
      .mockResolvedValueOnce([]);

    const result = await service.search({ userId: 'user-1', page: 3, pageSize: 10 });
    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(10);
    expect(result.totalPages).toBe(5);

    const dataQuery = mockQueryRawUnsafe.mock.calls[1][0] as string;
    expect(dataQuery).toContain('OFFSET 20');
  });

  it('clamps pageSize to 100', async () => {
    mockQueryRawUnsafe.mockReset();
    mockQueryRawUnsafe
      .mockResolvedValueOnce([{ total: 0 }])
      .mockResolvedValueOnce([]);

    const result = await service.search({ userId: 'user-1', pageSize: 500 });
    expect(result.pageSize).toBe(100);
  });

  it('formats results correctly', async () => {
    mockQueryRawUnsafe.mockReset();
    mockQueryRawUnsafe
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([{
        id: 'tx-1', reference: '#WP-2026-001', senderId: 'user-1', receiverId: 'user-2',
        amount: 5000, fee: 0, status: 'COMPLETED', description: 'Test',
        paymentMethod: 'WALLET', createdAt: new Date('2026-04-01'),
      }]);

    const result = await service.search({ userId: 'user-1' });
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0].type).toBe('sent');
    expect(result.transactions[0].amountFormatted).toBe('$5.000');
    expect(result.transactions[0].reference).toBe('#WP-2026-001');
  });

  it('classifies sent vs received correctly', async () => {
    mockQueryRawUnsafe.mockReset();
    mockQueryRawUnsafe
      .mockResolvedValueOnce([{ total: 1 }])
      .mockResolvedValueOnce([{
        id: 'tx-2', reference: '#WP-R', senderId: 'other', receiverId: 'user-1',
        amount: 3000, fee: 0, status: 'COMPLETED', description: null,
        paymentMethod: 'WALLET', createdAt: new Date(),
      }]);

    const result = await service.search({ userId: 'user-1' });
    expect(result.transactions[0].type).toBe('received');
  });

  it('returns empty on DB error', async () => {
    mockQueryRawUnsafe.mockReset();
    mockQueryRawUnsafe.mockRejectedValue(new Error('DB down'));

    const result = await service.search({ userId: 'user-1' });
    expect(result.transactions).toHaveLength(0);
    expect(result.total).toBe(0);
  });
});
