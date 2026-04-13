import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-product-review');
const PREFIX = 'merchant:product-review:';
const TTL = 365 * 24 * 60 * 60;

export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ProductReview {
  id: string;
  merchantId: string;
  productId: string;
  customerId: string;
  customerName: string;
  rating: number;
  title: string;
  comment: string;
  status: ReviewStatus;
  verifiedPurchase: boolean;
  helpful: number;
  createdAt: string;
  moderatedAt?: string;
}

export class MerchantProductReviewService {
  private key(merchantId: string): string {
    return `${PREFIX}${merchantId}`;
  }

  async list(merchantId: string): Promise<ProductReview[]> {
    const raw = await getRedis().get(this.key(merchantId));
    return raw ? JSON.parse(raw) : [];
  }

  async submit(input: {
    merchantId: string;
    productId: string;
    customerId: string;
    customerName: string;
    rating: number;
    title: string;
    comment: string;
    verifiedPurchase?: boolean;
  }): Promise<ProductReview> {
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
      throw new Error('Rating debe ser entero entre 1 y 5');
    }
    if (input.title.length < 3 || input.title.length > 100) {
      throw new Error('Titulo debe tener entre 3 y 100 caracteres');
    }
    if (input.comment.length < 10 || input.comment.length > 1000) {
      throw new Error('Comentario debe tener entre 10 y 1000 caracteres');
    }
    const list = await this.list(input.merchantId);
    if (list.some(r => r.customerId === input.customerId && r.productId === input.productId)) {
      throw new Error('Ya dejaste una resena para este producto');
    }
    const review: ProductReview = {
      id: `rev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      merchantId: input.merchantId,
      productId: input.productId,
      customerId: input.customerId,
      customerName: input.customerName,
      rating: input.rating,
      title: input.title,
      comment: input.comment,
      status: 'PENDING',
      verifiedPurchase: input.verifiedPurchase ?? false,
      helpful: 0,
      createdAt: new Date().toISOString(),
    };
    list.push(review);
    if (list.length > 2000) list.splice(0, list.length - 2000);
    await getRedis().set(this.key(input.merchantId), JSON.stringify(list), { EX: TTL });
    log.info('review submitted', { id: review.id });
    return review;
  }

  async moderate(merchantId: string, id: string, status: ReviewStatus): Promise<ProductReview | null> {
    if (status === 'PENDING') throw new Error('Solo puede moderar a APPROVED o REJECTED');
    const list = await this.list(merchantId);
    const review = list.find(r => r.id === id);
    if (!review) return null;
    review.status = status;
    review.moderatedAt = new Date().toISOString();
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return review;
  }

  async markHelpful(merchantId: string, id: string): Promise<ProductReview | null> {
    const list = await this.list(merchantId);
    const review = list.find(r => r.id === id);
    if (!review) return null;
    if (review.status !== 'APPROVED') return null;
    review.helpful++;
    await getRedis().set(this.key(merchantId), JSON.stringify(list), { EX: TTL });
    return review;
  }

  async getByProduct(merchantId: string, productId: string, approvedOnly = true): Promise<ProductReview[]> {
    const list = await this.list(merchantId);
    return list.filter(r => r.productId === productId && (!approvedOnly || r.status === 'APPROVED'));
  }

  async getProductStats(merchantId: string, productId: string): Promise<{
    totalReviews: number;
    averageRating: number;
    distribution: Record<number, number>;
    verifiedPurchaseCount: number;
  }> {
    const reviews = await this.getByProduct(merchantId, productId, true);
    const total = reviews.length;
    if (total === 0) {
      return { totalReviews: 0, averageRating: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, verifiedPurchaseCount: 0 };
    }
    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const r of reviews) distribution[r.rating]++;
    const avg = reviews.reduce((s, r) => s + r.rating, 0) / total;
    return {
      totalReviews: total,
      averageRating: Math.round(avg * 10) / 10,
      distribution,
      verifiedPurchaseCount: reviews.filter(r => r.verifiedPurchase).length,
    };
  }

  async getPendingReviews(merchantId: string): Promise<ProductReview[]> {
    const list = await this.list(merchantId);
    return list.filter(r => r.status === 'PENDING');
  }
}

export const merchantProductReview = new MerchantProductReviewService();
