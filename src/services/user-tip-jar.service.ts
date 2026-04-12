import { getRedis } from '../config/database';
import { createLogger } from '../config/logger';
import { formatCLP } from '../utils/format';

const log = createLogger('tip-jar');
const TJ_PREFIX = 'tipjar:';
const TJ_TTL = 365 * 24 * 60 * 60;

export interface TipJar {
  userId: string;
  slug: string;
  displayName: string;
  message: string;
  totalReceived: number;
  tipCount: number;
  topTip: number;
  suggestedAmounts: number[];
  active: boolean;
  createdAt: string;
}

export class UserTipJarService {
  async createJar(input: { userId: string; slug: string; displayName: string; message: string; suggestedAmounts?: number[] }): Promise<TipJar> {
    if (!/^[a-z0-9-]+$/.test(input.slug)) throw new Error('Slug alfanumerico con guiones.');
    if (input.slug.length > 30) throw new Error('Slug maximo 30 caracteres.');

    const existing = await this.getJarBySlug(input.slug);
    if (existing) throw new Error('Slug ya en uso.');

    const jar: TipJar = {
      userId: input.userId,
      slug: input.slug,
      displayName: input.displayName,
      message: input.message,
      totalReceived: 0,
      tipCount: 0,
      topTip: 0,
      suggestedAmounts: input.suggestedAmounts ?? [1000, 2000, 5000, 10000],
      active: true,
      createdAt: new Date().toISOString(),
    };
    try { const redis = getRedis(); await redis.set(TJ_PREFIX + input.slug, JSON.stringify(jar), { EX: TJ_TTL }); }
    catch (err) { log.warn('Failed to save jar', { error: (err as Error).message }); }
    return jar;
  }

  async sendTip(slug: string, amount: number): Promise<{ success: boolean; error?: string }> {
    const jar = await this.getJarBySlug(slug);
    if (!jar) return { success: false, error: 'Tip jar no encontrado.' };
    if (!jar.active) return { success: false, error: 'Tip jar inactivo.' };
    if (amount < 500) return { success: false, error: 'Propina minima: $500.' };

    jar.totalReceived += amount;
    jar.tipCount++;
    if (amount > jar.topTip) jar.topTip = amount;
    try { const redis = getRedis(); await redis.set(TJ_PREFIX + slug, JSON.stringify(jar), { EX: TJ_TTL }); }
    catch { return { success: false }; }
    return { success: true };
  }

  async getJarBySlug(slug: string): Promise<TipJar | null> {
    try { const redis = getRedis(); const raw = await redis.get(TJ_PREFIX + slug); return raw ? JSON.parse(raw) as TipJar : null; }
    catch { return null; }
  }

  getJarUrl(slug: string): string {
    return 'https://whatpay.cl/tip/' + slug;
  }

  formatJarSummary(jar: TipJar): string {
    const avg = jar.tipCount > 0 ? Math.round(jar.totalReceived / jar.tipCount) : 0;
    return jar.displayName + ': ' + formatCLP(jar.totalReceived) + ' en ' + jar.tipCount + ' propinas (promedio ' + formatCLP(avg) + ')';
  }
}

export const userTipJar = new UserTipJarService();
