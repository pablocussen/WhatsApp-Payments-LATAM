import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-feedback');

const FB_PREFIX = 'mfeedback:';
const FB_TTL = 365 * 24 * 60 * 60;
const MAX_REVIEWS = 1000;

export interface Review {
  id: string;
  merchantId: string;
  customerId: string;
  customerName: string | null;
  rating: number;
  comment: string | null;
  reply: string | null;
  flagged: boolean;
  createdAt: string;
  updatedAt: string;
}

export class MerchantFeedbackService {
  async submitReview(input: {
    merchantId: string;
    customerId: string;
    customerName?: string;
    rating: number;
    comment?: string;
  }): Promise<Review> {
    if (input.rating < 1 || input.rating > 5) throw new Error('Rating entre 1 y 5.');
    if (input.comment && input.comment.length > 500) throw new Error('Comentario máximo 500 caracteres.');

    const reviews = await this.getReviews(input.merchantId);

    // Check if customer already reviewed — update instead
    const existing = reviews.find(r => r.customerId === input.customerId);
    if (existing) {
      existing.rating = input.rating;
      existing.comment = input.comment ?? existing.comment;
      existing.updatedAt = new Date().toISOString();
      await this.save(input.merchantId, reviews);
      return existing;
    }

    if (reviews.length >= MAX_REVIEWS) throw new Error('Límite de reviews alcanzado.');

    const review: Review = {
      id: `rev_${Date.now().toString(36)}`,
      merchantId: input.merchantId,
      customerId: input.customerId,
      customerName: input.customerName ?? null,
      rating: input.rating,
      comment: input.comment ?? null,
      reply: null,
      flagged: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    reviews.push(review);
    await this.save(input.merchantId, reviews);

    log.info('Review submitted', { merchantId: input.merchantId, rating: input.rating });
    return review;
  }

  async getReviews(merchantId: string): Promise<Review[]> {
    try {
      const redis = getRedis();
      const raw = await redis.get(`${FB_PREFIX}${merchantId}`);
      return raw ? JSON.parse(raw) as Review[] : [];
    } catch {
      return [];
    }
  }

  async getReviewsPaginated(merchantId: string, offset = 0, limit = 10): Promise<{ reviews: Review[]; total: number }> {
    const all = await this.getReviews(merchantId);
    const visible = all.filter(r => !r.flagged);
    return {
      reviews: visible.slice(offset, offset + limit),
      total: visible.length,
    };
  }

  async getAverageRating(merchantId: string): Promise<{ avg: number; count: number }> {
    const reviews = await this.getReviews(merchantId);
    const visible = reviews.filter(r => !r.flagged);
    if (visible.length === 0) return { avg: 0, count: 0 };
    const sum = visible.reduce((s, r) => s + r.rating, 0);
    return { avg: Math.round((sum / visible.length) * 10) / 10, count: visible.length };
  }

  async replyToReview(merchantId: string, reviewId: string, reply: string): Promise<boolean> {
    if (!reply || reply.length > 500) throw new Error('Respuesta entre 1 y 500 caracteres.');
    const reviews = await this.getReviews(merchantId);
    const review = reviews.find(r => r.id === reviewId);
    if (!review) return false;
    if (review.reply) throw new Error('Ya existe una respuesta.');
    review.reply = reply;
    await this.save(merchantId, reviews);
    return true;
  }

  async flagReview(merchantId: string, reviewId: string): Promise<boolean> {
    const reviews = await this.getReviews(merchantId);
    const review = reviews.find(r => r.id === reviewId);
    if (!review) return false;
    review.flagged = true;
    await this.save(merchantId, reviews);
    return true;
  }

  getReviewSummary(merchantId: string, avg: number, count: number): string {
    const stars = '★'.repeat(Math.round(avg)) + '☆'.repeat(5 - Math.round(avg));
    return `${stars} ${avg}/5 (${count} reviews)`;
  }

  private async save(merchantId: string, reviews: Review[]): Promise<void> {
    try {
      const redis = getRedis();
      await redis.set(`${FB_PREFIX}${merchantId}`, JSON.stringify(reviews), { EX: FB_TTL });
    } catch (err) {
      log.warn('Failed to save feedback', { merchantId, error: (err as Error).message });
    }
  }
}

export const merchantFeedback = new MerchantFeedbackService();
