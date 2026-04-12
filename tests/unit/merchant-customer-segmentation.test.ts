const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantCustomerSegmentationService } from '../../src/services/merchant-customer-segmentation.service';

describe('MerchantCustomerSegmentationService', () => {
  let s: MerchantCustomerSegmentationService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantCustomerSegmentationService(); mockRedisGet.mockResolvedValue(null); });

  it('segments NEW customer (no tx)', () => {
    expect(s.segmentCustomer(0, 0, 0)).toBe('NEW');
  });
  it('segments ACTIVE customer', () => {
    expect(s.segmentCustomer(5, 50000, 3)).toBe('ACTIVE');
  });
  it('segments VIP with high spending', () => {
    expect(s.segmentCustomer(5, 800000, 15)).toBe('VIP');
  });
  it('segments INACTIVE (30-90 days)', () => {
    expect(s.segmentCustomer(60, 100000, 5)).toBe('INACTIVE');
  });
  it('segments CHURNED (>90 days)', () => {
    expect(s.segmentCustomer(120, 500000, 10)).toBe('CHURNED');
  });
  it('saves segmentation', async () => {
    const segments = s.buildEmptySegments();
    await s.saveSegmentation('m1', segments);
    expect(mockRedisSet).toHaveBeenCalled();
  });
  it('returns null for missing', async () => {
    expect(await s.getSegmentation('m1')).toBeNull();
  });
  it('returns stored segmentation', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify({ VIP: { count: 5 } }));
    const seg = await s.getSegmentation('m1');
    expect(seg?.VIP.count).toBe(5);
  });
  it('builds empty segments with all 5 types', () => {
    const empty = s.buildEmptySegments();
    expect(Object.keys(empty)).toHaveLength(5);
    expect(empty.VIP.name).toBe('VIP');
  });
});
