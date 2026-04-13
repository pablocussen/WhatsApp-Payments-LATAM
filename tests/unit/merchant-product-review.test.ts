const mockRedisGet = jest.fn();
const mockRedisSet = jest.fn().mockResolvedValue('OK');
jest.mock('../../src/config/database', () => ({ getRedis: jest.fn().mockReturnValue({ get: (...a: unknown[]) => mockRedisGet(...a), set: (...a: unknown[]) => mockRedisSet(...a) }) }));
jest.mock('../../src/config/logger', () => ({ createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) }));

import { MerchantProductReviewService } from '../../src/services/merchant-product-review.service';

describe('MerchantProductReviewService', () => {
  let s: MerchantProductReviewService;
  beforeEach(() => { jest.clearAllMocks(); s = new MerchantProductReviewService(); mockRedisGet.mockResolvedValue(null); });

  const base = {
    merchantId: 'm1',
    productId: 'p1',
    customerId: 'c1',
    customerName: 'Juan',
    rating: 5,
    title: 'Excelente producto',
    comment: 'Funciona muy bien y llego rapido',
  };

  it('submits review in PENDING', async () => {
    const r = await s.submit(base);
    expect(r.status).toBe('PENDING');
    expect(r.helpful).toBe(0);
  });

  it('rejects invalid rating', async () => {
    await expect(s.submit({ ...base, rating: 6 })).rejects.toThrow('1 y 5');
    await expect(s.submit({ ...base, rating: 0 })).rejects.toThrow('1 y 5');
    await expect(s.submit({ ...base, rating: 3.5 })).rejects.toThrow('entero');
  });

  it('rejects short title', async () => {
    await expect(s.submit({ ...base, title: 'ok' })).rejects.toThrow('3 y 100');
  });

  it('rejects short comment', async () => {
    await expect(s.submit({ ...base, comment: 'malo' })).rejects.toThrow('10 y 1000');
  });

  it('rejects duplicate review from same customer', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ productId: 'p1', customerId: 'c1' }]));
    await expect(s.submit(base)).rejects.toThrow('Ya dejaste');
  });

  it('moderates to APPROVED', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'r1', status: 'PENDING' }]));
    const r = await s.moderate('m1', 'r1', 'APPROVED');
    expect(r?.status).toBe('APPROVED');
    expect(r?.moderatedAt).toBeDefined();
  });

  it('rejects moderate to PENDING', async () => {
    await expect(s.moderate('m1', 'r1', 'PENDING')).rejects.toThrow('APPROVED o REJECTED');
  });

  it('marks helpful only on approved', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'r1', status: 'APPROVED', helpful: 5 },
    ]));
    const r = await s.markHelpful('m1', 'r1');
    expect(r?.helpful).toBe(6);
  });

  it('skips helpful on pending review', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([{ id: 'r1', status: 'PENDING' }]));
    expect(await s.markHelpful('m1', 'r1')).toBeNull();
  });

  it('filters by product approved only', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { productId: 'p1', status: 'APPROVED' },
      { productId: 'p1', status: 'PENDING' },
      { productId: 'p2', status: 'APPROVED' },
    ]));
    const r = await s.getByProduct('m1', 'p1', true);
    expect(r).toHaveLength(1);
  });

  it('computes product stats', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { productId: 'p1', status: 'APPROVED', rating: 5, verifiedPurchase: true },
      { productId: 'p1', status: 'APPROVED', rating: 4, verifiedPurchase: true },
      { productId: 'p1', status: 'APPROVED', rating: 5, verifiedPurchase: false },
      { productId: 'p1', status: 'APPROVED', rating: 3, verifiedPurchase: true },
    ]));
    const stats = await s.getProductStats('m1', 'p1');
    expect(stats.totalReviews).toBe(4);
    expect(stats.averageRating).toBe(4.3);
    expect(stats.distribution[5]).toBe(2);
    expect(stats.verifiedPurchaseCount).toBe(3);
  });

  it('returns zero stats on empty', async () => {
    const stats = await s.getProductStats('m1', 'p1');
    expect(stats.totalReviews).toBe(0);
    expect(stats.averageRating).toBe(0);
  });

  it('returns pending reviews', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'r1', status: 'PENDING' },
      { id: 'r2', status: 'APPROVED' },
      { id: 'r3', status: 'PENDING' },
    ]));
    const pending = await s.getPendingReviews('m1');
    expect(pending).toHaveLength(2);
  });
});
