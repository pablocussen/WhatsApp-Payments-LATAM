import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';

const log = createLogger('merchant-nps-survey');
const PREFIX = 'merchant:nps:';
const TTL = 365 * 24 * 60 * 60;

export type NPSCategory = 'DETRACTOR' | 'PASSIVE' | 'PROMOTER';

export interface NPSResponse {
  id: string;
  merchantId: string;
  customerId: string;
  score: number;
  category: NPSCategory;
  comment?: string;
  transactionId?: string;
  createdAt: string;
}

export interface NPSStats {
  totalResponses: number;
  promoters: number;
  passives: number;
  detractors: number;
  npsScore: number;
  averageScore: number;
}

export class MerchantNPSSurveyService {
  private key(merchantId: string): string {
    return `${PREFIX}${merchantId}`;
  }

  private categorize(score: number): NPSCategory {
    if (score >= 9) return 'PROMOTER';
    if (score >= 7) return 'PASSIVE';
    return 'DETRACTOR';
  }

  async list(merchantId: string): Promise<NPSResponse[]> {
    const raw = await getRedis().get(this.key(merchantId));
    return raw ? JSON.parse(raw) : [];
  }

  async submitResponse(input: {
    merchantId: string;
    customerId: string;
    score: number;
    comment?: string;
    transactionId?: string;
  }): Promise<NPSResponse> {
    if (input.score < 0 || input.score > 10 || !Number.isInteger(input.score)) {
      throw new Error('Score debe ser entero entre 0 y 10');
    }
    if (input.comment && input.comment.length > 500) {
      throw new Error('Comentario excede 500 caracteres');
    }
    const list = await this.list(input.merchantId);
    const response: NPSResponse = {
      id: `nps_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      merchantId: input.merchantId,
      customerId: input.customerId,
      score: input.score,
      category: this.categorize(input.score),
      comment: input.comment,
      transactionId: input.transactionId,
      createdAt: new Date().toISOString(),
    };
    list.push(response);
    if (list.length > 1000) list.splice(0, list.length - 1000);
    await getRedis().set(this.key(input.merchantId), JSON.stringify(list), { EX: TTL });
    log.info('nps response submitted', { merchantId: input.merchantId, score: input.score });
    return response;
  }

  async getStats(merchantId: string, sinceDays?: number): Promise<NPSStats> {
    const list = await this.list(merchantId);
    const filtered = sinceDays
      ? list.filter(r => new Date(r.createdAt).getTime() > Date.now() - sinceDays * 86400000)
      : list;
    const total = filtered.length;
    if (total === 0) {
      return { totalResponses: 0, promoters: 0, passives: 0, detractors: 0, npsScore: 0, averageScore: 0 };
    }
    const promoters = filtered.filter(r => r.category === 'PROMOTER').length;
    const passives = filtered.filter(r => r.category === 'PASSIVE').length;
    const detractors = filtered.filter(r => r.category === 'DETRACTOR').length;
    const npsScore = Math.round(((promoters - detractors) / total) * 100);
    const averageScore = filtered.reduce((s, r) => s + r.score, 0) / total;
    return {
      totalResponses: total,
      promoters,
      passives,
      detractors,
      npsScore,
      averageScore: Math.round(averageScore * 10) / 10,
    };
  }

  async getDetractorComments(merchantId: string, limit = 20): Promise<NPSResponse[]> {
    const list = await this.list(merchantId);
    return list
      .filter(r => r.category === 'DETRACTOR' && r.comment && r.comment.length > 0)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit);
  }

  formatStats(stats: NPSStats): string {
    const rating = stats.npsScore >= 70 ? 'Excelente' : stats.npsScore >= 50 ? 'Bueno' : stats.npsScore >= 0 ? 'Regular' : 'Malo';
    return [
      `NPS: ${stats.npsScore} (${rating})`,
      `Respuestas: ${stats.totalResponses}`,
      `Promoters: ${stats.promoters}`,
      `Passives: ${stats.passives}`,
      `Detractors: ${stats.detractors}`,
      `Promedio: ${stats.averageScore}/10`,
    ].join('\n');
  }
}

export const merchantNPSSurvey = new MerchantNPSSurveyService();
