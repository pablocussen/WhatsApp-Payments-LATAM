/**
 * MerchantFeedbackService — reviews y ratings de clientes.
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

import { MerchantFeedbackService } from '../../src/services/merchant-feedback.service';

describe('MerchantFeedbackService', () => {
  let service: MerchantFeedbackService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new MerchantFeedbackService();
    mockRedisGet.mockResolvedValue(null);
  });

  it('submits review', async () => {
    const r = await service.submitReview({ merchantId: 'm1', customerId: 'c1', rating: 5, comment: 'Excelente!' });
    expect(r.id).toMatch(/^rev_/);
    expect(r.rating).toBe(5);
    expect(r.comment).toBe('Excelente!');
    expect(r.flagged).toBe(false);
  });

  it('updates existing review', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'rev_1', merchantId: 'm1', customerId: 'c1', rating: 3, comment: 'Ok', reply: null, flagged: false, updatedAt: '' },
    ]));
    const r = await service.submitReview({ merchantId: 'm1', customerId: 'c1', rating: 5, comment: 'Mejor!' });
    expect(r.rating).toBe(5);
    expect(r.comment).toBe('Mejor!');
  });

  it('rejects invalid rating', async () => {
    await expect(service.submitReview({ merchantId: 'm1', customerId: 'c1', rating: 6 }))
      .rejects.toThrow('1 y 5');
  });

  it('rejects long comment', async () => {
    await expect(service.submitReview({ merchantId: 'm1', customerId: 'c1', rating: 4, comment: 'x'.repeat(501) }))
      .rejects.toThrow('500');
  });

  it('returns empty for new merchant', async () => {
    expect(await service.getReviews('m1')).toEqual([]);
  });

  it('paginates reviews excluding flagged', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'r1', rating: 5, flagged: false },
      { id: 'r2', rating: 1, flagged: true },
      { id: 'r3', rating: 4, flagged: false },
      { id: 'r4', rating: 3, flagged: false },
    ]));
    const { reviews, total } = await service.getReviewsPaginated('m1', 0, 2);
    expect(total).toBe(3);
    expect(reviews).toHaveLength(2);
  });

  it('calculates average rating', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { rating: 5, flagged: false },
      { rating: 4, flagged: false },
      { rating: 3, flagged: false },
      { rating: 1, flagged: true },
    ]));
    const { avg, count } = await service.getAverageRating('m1');
    expect(avg).toBe(4);
    expect(count).toBe(3);
  });

  it('returns 0 avg for no reviews', async () => {
    const { avg, count } = await service.getAverageRating('m1');
    expect(avg).toBe(0);
    expect(count).toBe(0);
  });

  it('replies to review', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'rev_1', reply: null },
    ]));
    expect(await service.replyToReview('m1', 'rev_1', 'Gracias por tu feedback!')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].reply).toBe('Gracias por tu feedback!');
  });

  it('rejects double reply', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'rev_1', reply: 'Ya respondí' },
    ]));
    await expect(service.replyToReview('m1', 'rev_1', 'Otra')).rejects.toThrow('Ya existe');
  });

  it('flags review', async () => {
    mockRedisGet.mockResolvedValue(JSON.stringify([
      { id: 'rev_1', flagged: false },
    ]));
    expect(await service.flagReview('m1', 'rev_1')).toBe(true);
    const saved = JSON.parse(mockRedisSet.mock.calls[0][1]);
    expect(saved[0].flagged).toBe(true);
  });

  it('formats summary with stars', () => {
    const s = service.getReviewSummary('m1', 4.2, 50);
    expect(s).toContain('★★★★☆');
    expect(s).toContain('4.2/5');
    expect(s).toContain('50 reviews');
  });
});
