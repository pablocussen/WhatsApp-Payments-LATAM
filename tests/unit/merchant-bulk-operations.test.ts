const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantBulkOperationsService } from '../../src/services/merchant-bulk-operations.service';

describe('MerchantBulkOperationsService', () => {
  let s: MerchantBulkOperationsService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantBulkOperationsService(); mockRedisGet.mockResolvedValue(null); });

  it('creates operation', async () => {
    const op = await s.createOperation('m1', 'REFUND', 50);
    expect(op.id).toMatch(/^bulk_/);
    expect(op.status).toBe('QUEUED');
    expect(op.totalItems).toBe(50);
  });
  it('rejects invalid count', async () => {
    await expect(s.createOperation('m1', 'EXPORT', 0)).rejects.toThrow('1 y 10000');
    await expect(s.createOperation('m1', 'EXPORT', 20000)).rejects.toThrow('1 y 10000');
  });
  it('updates progress', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'bulk_1', totalItems: 100, status: 'QUEUED' }));
    expect(await s.updateProgress('bulk_1', 50, 48, 2)).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved.processed).toBe(50);
    expect(saved.status).toBe('PROCESSING');
  });
  it('completes with COMPLETED status when all succeed', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'bulk_1', processed: 100, succeeded: 100, failed: 0 }));
    const op = await s.completeOperation('bulk_1');
    expect(op?.status).toBe('COMPLETED');
  });
  it('completes with PARTIAL when some fail', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'bulk_1', processed: 100, succeeded: 95, failed: 5 }));
    const op = await s.completeOperation('bulk_1');
    expect(op?.status).toBe('PARTIAL');
  });
  it('completes with FAILED when all fail', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ id: 'bulk_1', processed: 100, succeeded: 0, failed: 100 }));
    const op = await s.completeOperation('bulk_1');
    expect(op?.status).toBe('FAILED');
  });
  it('calculates progress %', () => {
    expect(s.getProgress({ totalItems: 100, processed: 50 } as any)).toBe(50);
    expect(s.getProgress({ totalItems: 0, processed: 0 } as any)).toBe(0);
  });
  it('returns null for missing op', async () => {
    expect(await s.getOperation('nope')).toBeNull();
  });
});
